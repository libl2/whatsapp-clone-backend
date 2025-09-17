// C:\Users\user\Documents\wa-web\WhatsppWeb-React\whatsapp-clone-backend\src\whatsapp\whatsapp.service.ts
import { ConsoleLogger, Inject, Injectable, forwardRef } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
import { toDataURL } from 'qrcode';
import { SocketService } from '../socket/socket.service';
import { AppService } from '../app/app.service'; // ייבוא AppService
import WAWebJS from 'whatsapp-web.js'; 

@Injectable()
export class WhatsAppService {
  client: Client;
  private _logger = new ConsoleLogger('WAService');
  private _qrCode = '';
  status: string = 'initializing';

  constructor(
    private readonly socketService: SocketService,
    @Inject(forwardRef(() => AppService))
    private readonly appService: AppService // הזרקת AppService באמצעות forwardRef
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
    this.client.on('message', this.onMessageWithMediaHandling); // שינוי כאן!
    this.client.on('loading_screen', this.onLoadingScreen);
    this.client.on('message_create', this.onMessageCreate);
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
    this._qrCode = '';
    this.socketService.send('ready');
    this._logger.log('Client is ready');
  };
  private onAuthenticated = () => {
    this.status = 'authenticated';
    this.socketService.send('authenticated');
    this._logger.log('Client is authenticated');
  };
  private onAuthFailure = (msg) => {
    this.status = 'auth_failure';
    this.socketService.send('authentication_failed');
    this._logger.log('Client is authentication failed', msg);
  };
  private onLoadingScreen = (percent, msg) => {
    this.socketService.send('loading', { percent, msg });
    this._logger.log(`Client is loading: ${percent}; ${msg}`);
  };
  
  // פונקציה חדשה לטיפול בהודעות נכנסות כולל מדיה
  private onMessageWithMediaHandling = async (msg: WAWebJS.Message) => {
    this.socketService.send('message', { msg }); // שלח את ההודעה המקורית ל-frontend
    this._logger.log(`Message has been received: ${msg.id.id}`);

    if (msg.hasMedia) {
      // הפעל את הורדת המדיה דרך ה-AppService באופן אסינכרוני
      // (הפונקציה downloadMediaAsync כבר שולחת עדכון ל-socketService)
      (this.appService as any).downloadMediaAsync(msg); // קאסט ל-any כדי למנוע בעיות עם פרטיות
    }
  };

  private onMessageCreate = (msg) => {
    this._logger.log('onMessageCreate', msg);
    // אם תרצה לטפל גם בהודעות שאתה יוצר, תוכל להוסיף כאן לוגיקה דומה
    if (msg.hasMedia) {
      (this.appService as any).downloadMediaAsync(msg);
    }
  };
  private onMessage = (msg) => {
    this.socketService.send('message', { msg });
    this._logger.log(`Message has been recived: ${msg}`, msg);
  };
  private onMessageRevokeEveryone = (after, before) => {
    this._logger.log('onMessageRevokeEveryone', after, before);
  };
  private onMessageRevokeMe = (msg) => {
    this._logger.log('onMessageRevokeEveryone', msg);
  };
  private onMessageAck = (msg, ack) => {
    this._logger.log('onMessageAck', msg, ack);
  };
  private onGroupJoin = (notification) => {
    this._logger.log('onGroupJoin', notification);
  };
  private onGroupLeave = (notification) => {
    this._logger.log('onGroupLeave', notification);
  };
  private onGroupUpdate = (notification) => {
    this._logger.log('onGroupUpdate', notification);
  };
  private onGroupAdminChanged = (notification) => {
    this._logger.log('onGroupAdminChanged', notification);
  };
  private onStateChanged = (state) => {
    this._logger.log('onStateChanged', state);
  };
  private onDisconnected = (reason) => {
    this.status = 'disconnected';
    this._logger.log('onDisconnected', reason);
  };
  private onContactChanged = (message, oldId, newId, isContact) => {
    this._logger.log('onContactChanged', message, oldId, newId, isContact);
  };
}
