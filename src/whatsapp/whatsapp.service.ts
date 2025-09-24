import { ConsoleLogger, Injectable } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
import { toDataURL } from 'qrcode';
import { SocketService } from '../socket/socket.service';
import { MediaService } from '../media/media.service';
import WAWebJS from 'whatsapp-web.js';

@Injectable()
export class WhatsAppService {
  client: Client;
  private _logger = new ConsoleLogger('WAService');
  private _qrCode = ''; // נשמר פרטי
  status: string = 'initializing';

  // ה-getter עבור qr
  public get qr(): string { // נשנה ל-public getter ליתר ביטחון, אם הבעיה ממשיכה
    return this._qrCode;
  }

  // בדיקה אם הקליינט מוכן לשימוש
  public get isClientReady(): boolean {
    return this.client && this.status === 'ready';
  }

  constructor(
    private readonly socketService: SocketService,
    private readonly mediaService: MediaService
  ) {}

  initClient(): Promise<void> {
    this._logger.log('Client init start');
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './data/auth',
      }),
      puppeteer: {
        headless: false,
        executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
        args: [
          '--no-sandbox',
        ],
      },
    });

    this.client.on('qr', (...args) => { this._logger.log('EVENT: qr'); this.onQR(...args); });
    this.client.on('ready', (...args) => { this._logger.log('EVENT: ready'); this.onReady(...args); });
    this.client.on('authenticated', () => { this._logger.log('EVENT: authenticated'); this.onAuthenticated(); });
    this.client.on('auth_failure', (...args) => { this._logger.log('EVENT: auth_failure'); this.onAuthFailure(...args); });
    this.client.on('disconnected', (...args) => { this._logger.log('EVENT: disconnected'); this.onDisconnected(...args); });
    
    // נשנה את handler ההודעות כדי ש-AppService יטפל גם במדיה
    this.client.on('message', this.onMessageWithMediaHandling); 
    this.client.on('message_create', this.onMessageCreateWithMediaHandling); // נטפל גם בהודעות שאנו יוצרים

    this.client.on('loading_screen', this.onLoadingScreen);
    this.client.on('message_revoke_everyone', this.onMessageRevokeEveryone);
    this.client.on('message_revoke_me', this.onMessageRevokeMe);
    this.client.on('message_ack', this.onMessageAck);
    this.client.on('group_join', this.onGroupJoin);
    this.client.on('group_leave', this.onGroupLeave);
    this.client.on('group_update', this.onGroupUpdate);
    this.client.on('group_admin_changed', this.onGroupAdminChanged);
    this.client.on('change_state', this.onStateChanged);
    this.client.on('contact_changed', this.onContactChanged);
    const promise = this.client.initialize();
    this._logger.log('Client init done');
    return promise;
  }

  private onQR = async (qr: string) => {
    this.status = 'qr';
    this._qrCode = await toDataURL(qr);
    this.socketService.send('qr', { qr: this._qrCode });
    this._logger.log('QR code sent to client');
  };
  private onReady = () => {
    this.status = 'ready';
    this._qrCode = ''; // ננקה QR ברגע שהקליינט מוכן
    this.socketService.send('ready');
    this._logger.log('Client is ready');
  };
  private onAuthenticated = () => {
    this.status = 'authenticated';
    this.socketService.send('authenticated');
    this._logger.log('Client is authenticated');
  };
  private onAuthFailure = (msg: string) => { // msg הוא בדרך כלל string
    this.status = 'auth_failure';
    this.socketService.send('authentication_failed');
    this._logger.log('Client is authentication failed', msg);
  };
  private onLoadingScreen = (percent: string, msg: string) => { // הוספת טיפוסים
    this.socketService.send('loading', { percent, msg });
    this._logger.log(`Client is loading: ${percent}; ${msg}`);
  };
  
  // פונקציה חדשה לטיפול בהודעות נכנסות כולל מדיה
  private onMessageWithMediaHandling = async (msg: WAWebJS.Message) => {
    // שלח את ההודעה המקורית ל-frontend מיד
    this.socketService.send('message', { msg }); 
    this._logger.log(`Message has been received: ${msg.id.id}`);

    if (msg.hasMedia) {
      // קבל את המטא-דאטה של המדיה
      const mediaMetadata = await this.mediaService.getMediaMetadata(msg);
      if (mediaMetadata) {
        // הפעל את הורדת המדיה דרך ה-MediaService באופן אסינכרוני
        this.mediaService.downloadMediaAsync(msg, mediaMetadata);
      }
    }
  };

  private onMessageCreateWithMediaHandling = async (msg: WAWebJS.Message) => {
    this._logger.log('onMessageCreate', msg.id.id);
    // שלח את ההודעה שיצרנו ל-frontend מיד
    this.socketService.send('message_create', { msg }); 

    // אם זו הודעת מדיה שנוצרה על ידינו, נטפל בהורדה שלה (אם היא נשלחה כקובץ)
    if (msg.hasMedia) {
        const mediaMetadata = await this.mediaService.getMediaMetadata(msg);
        if (mediaMetadata) {
            this.mediaService.downloadMediaAsync(msg, mediaMetadata);
        }
    }
  };
  
  private onMessageRevokeEveryone = (after: WAWebJS.Message, before: WAWebJS.Message | null) => {
    this._logger.log('onMessageRevokeEveryone', after.id.id, before?.id.id);
    this.socketService.send('message_revoke_everyone', { after, before });
  };
  private onMessageRevokeMe = (msg: WAWebJS.Message) => {
    this._logger.log('onMessageRevokeMe', msg.id.id);
    this.socketService.send('message_revoke_me', { msg });
  };
  private onMessageAck = (msg: WAWebJS.Message, ack: WAWebJS.MessageAck) => {
    this._logger.log('onMessageAck', msg.id.id, ack);
    this.socketService.send('message_ack', { msg, ack });
  };
  private onGroupJoin = (notification: WAWebJS.GroupNotification) => { // הוספנו WAWebJS.GroupNotification
    this._logger.log('onGroupJoin', notification.id); // תיקון: notification.id בלבד
    this.socketService.send('group_join', { notification });
  };
  private onGroupLeave = (notification: WAWebJS.GroupNotification) => { // הוספנו WAWebJS.GroupNotification
    this._logger.log('onGroupLeave', notification.id); // תיקון: notification.id בלבד
    this.socketService.send('group_leave', { notification });
  };
  private onGroupUpdate = (notification: WAWebJS.GroupNotification) => { // הוספנו WAWebJS.GroupNotification
    this._logger.log('onGroupUpdate', notification.id); // תיקון: notification.id בלבד
    this.socketService.send('group_update', { notification });
  };
  private onGroupAdminChanged = (notification: WAWebJS.GroupNotification) => { // הוספנו WAWebJS.GroupNotification
    this._logger.log('onGroupAdminChanged', notification.id); // תיקון: notification.id בלבד
    this.socketService.send('group_admin_changed', { notification });
  };
  private onStateChanged = (state: WAWebJS.WAState) => {
    this._logger.log('onStateChanged', state);
    this.socketService.send('change_state', { state });
  };
  private onDisconnected = (reason: string) => { // תיקון: reason הוא כנראה string, לא WAWebJS.ClientDisconnectedReason
    this.status = 'disconnected';
    this._logger.log('onDisconnected', reason);
    this.socketService.send('disconnected', { reason });
  };
  private onContactChanged = (message: WAWebJS.Message, oldId: string, newId: string, isContact: boolean) => {
    this._logger.log('onContactChanged', message.id.id, oldId, newId, isContact);
    this.socketService.send('contact_changed', { message, oldId, newId, isContact });
  };
}
