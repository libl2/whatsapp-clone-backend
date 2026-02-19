import {
  BadRequestException,
  ConsoleLogger,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import WAWebJS from 'whatsapp-web.js';
import * as fs from 'fs';
import * as path from 'path';
import { SocketService } from '../socket/socket.service'; // Make sure the path is correct

@Injectable()
export class AppService {
  private _logger = new ConsoleLogger('AppService');
  private readonly MEDIA_SAVE_PATH = path.join(__dirname, '..', '..', 'media');
  private readonly BASE_URL = 'http://localhost:3100';
  private _statuses: any[] = []; // שמירת סטטוסים בזיכרון

  constructor(
    private readonly waService: WhatsAppService,
    private readonly socketService: SocketService, // Injecting the SocketService
  ) {
    if (!fs.existsSync(this.MEDIA_SAVE_PATH)) {
      fs.mkdirSync(this.MEDIA_SAVE_PATH, { recursive: true });
    }
    // לא מאזינים כאן! ההאזנה תתבצע אחרי שה-client מוכן
  }

  init() {
    this._logger.log('Calling waService.initClient()');
    this.waService
      .initClient()
      .catch((err) => {
        this._logger.error('initClient error: ' + err.message);
      })
      .then(() => {
        this._logger.log('Client released');
        this.setupStatusListener();
      });
  }

  /**
   * מאזין להודעות סטטוס אחרי שה-client מוכן
   */
  private setupStatusListener() {
    if (!this.waService.client) {
      this._logger.error('WhatsApp client is not initialized!');
      return;
    }

    this.waService.client.on('message', async (message: WAWebJS.Message) => {
      // זיהוי הודעת סטטוס לפי השולח
      if (message.from === 'status@broadcast') {
        // נסיון למציאת מזהה השולח ממקורות שונים בהודעה
        let contactId = this.extractContactId(message);
        let contactName: string = null;
        let contactAvatar: string = null;

        if (contactId) {
          // sanitize id: אם חסר suffix, הוסף @c.us
          if (!contactId.includes('@')) {
            contactId = `${contactId}@c.us`;
          }

          let resolvedName: string = null;
          const msg = message as any; // Cast to any to access undocumented fields

          // 1) FIRST: try notifyName from the message itself (זהו השם שמוצג על הסטטוס)
          if (msg.notifyName && msg.notifyName.trim()) {
            resolvedName = msg.notifyName.trim();
            this._logger.log(`[Status] Got name from message.notifyName: ${resolvedName}`);
          }

          // 2) SECOND: try _data.notifyName or _data.pushname
          if (!resolvedName && msg._data) {
            if (msg._data.notifyName && msg._data.notifyName.trim()) {
              resolvedName = msg._data.notifyName.trim();
              this._logger.log(`[Status] Got name from _data.notifyName: ${resolvedName}`);
            } else if (msg._data.pushname && msg._data.pushname.trim()) {
              resolvedName = msg._data.pushname.trim();
              this._logger.log(`[Status] Got name from _data.pushname: ${resolvedName}`);
            }
          }

          // 3) THIRD: try contact details from WA client (matches chat list resolution)
          if (!resolvedName) {
            try {
              const contact = await this.waService.client.getContactById(contactId);
              if (contact) {
                const fromContact =
                  (contact as any).name ||
                  (contact as any).pushname ||
                  (contact as any).verifiedName ||
                  (contact as any).shortName;
                if (fromContact && String(fromContact).trim()) {
                  resolvedName = String(fromContact).trim();
                  this._logger.log(`[Status] Got name from contact object: ${resolvedName}`);
                }
              }
            } catch (err) {
              this._logger.warn(`[Status] getContactById failed for ${contactId}: ${err?.message || err}`);
            }
          }

          // 3) FALLBACK: use id part or +phone number
          contactName = resolvedName || contactId.split('@')[0];
          if (/^\d+$/.test(contactName)) {
            contactName = `+${contactName}`;
          }

          // Try to get avatar (may also fail, but that's ok - we have fallback on frontend)
          try {
            contactAvatar = await this.waService.client.getProfilePicUrl(contactId);
          } catch {
            this._logger.log(`[Status] getProfilePicUrl failed for ${contactId}, will use fallback`);
            contactAvatar = null;
          }
        } else {
          // לא הצלחנו לחלץ id — נספק fallback כללי
          contactId = null;
          contactName = 'לא ידוע';
          contactAvatar = null;
        }

        // עיבוד מדיה אם יש
        if (message.hasMedia) {
          await this.processMessageMediaInBackground(message);
        }

        const statusItem = {
          id: message.id?._serialized ?? (message.id && message.id.id) ?? String(Date.now()),
          from: message.from,
          timestamp: message.timestamp,
          body: message.body,
          type: message.type,
          mediaUrl: (message as any).mediaUrl || null,
          contactId,
          contactName,
          contactAvatar,
        };

        // שמירה בזיכרון
        this._statuses.push(statusItem);

        // שליחה ללקוח דרך סוקט
        this.socketService.send('status-update', statusItem);
      }
    });
    this._logger.log('Status listener is set up!');
  }

  // helper: extract contact id from various places in the message object (status broadcasts are tricky)
  private extractContactId(message: any): string | null {
    // 1) common: message.author or message.participant
    if (message.author) return message.author;
    if (message.participant) return message.participant;

    // 2) message._data may contain participant/author depending on WAWebJS version
    if (message._data) {
      if (message._data.author) return message._data.author;
      if (message._data.participant) return message._data.participant;
    }

    // 3) try to parse from id serialized (many status ids include the origin contact at the end)
    const serialized = message.id?._serialized || message.id;
    if (typeof serialized === 'string') {
      const match = serialized.match(/([0-9]+@c\.us|[0-9]+@s\.whatsapp\.net)/);
      if (match) return match[1];
      // sometimes the serialized id ends with _{contact}@c.us
      const parts = serialized.split('_');
      const last = parts[parts.length - 1] || '';
      if (/@(c\.us|s\.whatsapp\.net)$/.test(last)) return last;
    }

    // 4) sometimes message.from contains the contact for non-broadcast - but for status@broadcast it's not useful
    if (message.from && message.from !== 'status@broadcast') return message.from;

    return null;
  }

  getQR() {
    return this.waService.qr;
  }

  private ensureClientReady(operation: string): void {
    if (!this.waService.client || this.waService.status !== 'ready') {
      throw new ServiceUnavailableException(
        `WhatsApp client is not ready for ${operation}. Current status: ${this.waService.status}`,
      );
    }
  }

  async getAvatar(id: string): Promise<string> {
    this.ensureClientReady('getAvatar');
    return await this.waService.client.getProfilePicUrl(id);
  }

  async getChats(): Promise<WAWebJS.Chat[]> {
    this.ensureClientReady('getChats');
    return await this.waService.client.getChats();
  }

  async getMessages(id: string, model: any): Promise<WAWebJS.Message[]> {
    this.ensureClientReady('getMessages');
    try {
      const chat = await this.waService.client.getChatById(id);
      const messages = await chat.fetchMessages(model);

      // Run media processing in the background without waiting
      messages.forEach(message => {
        if (message.hasMedia) {
          this.processMessageMediaInBackground(message); // Call without await
        }
      });

      // Return messages immediately
      return messages;
    } catch (err) {
      this._logger.error(`Error fetching messages for chat ${id}: ${err.message}`);
      throw err;
    }
  }
  
  // =================================================================
  // RESTORED METHOD 1: searchMessages
  // =================================================================
  async searchMessages(model: any): Promise<WAWebJS.Message[]> {
    this.ensureClientReady('searchMessages');
    try {
      const messages = await this.waService.client.searchMessages(model.query, {
        chatId: model.chatId,
        page: model.page,
        limit: model.limit,
      });
      
      messages.forEach(message => {
        if (message.hasMedia) {
          this.processMessageMediaInBackground(message);
        }
      });

      return messages;
    } catch (err) {
      this._logger.error(`Error searching messages: ${err.message}`);
      throw err;
    }
  }

  // =================================================================
  // RESTORED METHOD 2: sendMessage
  // =================================================================
  async sendMessage(id: string, model: any): Promise<WAWebJS.Message> {
    this.ensureClientReady('sendMessage');
    try {
      if (model.message) {
        return await this.waService.client.sendMessage(id, model.message);
      }
      throw new BadRequestException('Message content is missing in the model.');
    } catch (err) {
      this._logger.error(`Failed to send message to ${id}: ${err.message}`);
      throw err;
    }
  }

  async markChatAsRead(id: string): Promise<{ success: boolean }> {
    this.ensureClientReady('markChatAsRead');
    try {
      const chat = await this.waService.client.getChatById(id);
      await chat.sendSeen();
      return { success: true };
    } catch (err) {
      this._logger.error(`Failed to mark chat as read for ${id}: ${err.message}`);
      throw err;
    }
  }

  // =================================================================
  // RESTORED METHOD 3: getStatus
  // =================================================================
  getStatus() {
    return {
      whatsapp: this.waService.status,
    };
  }

    // =================================================================
    // NEW: Get collected statuses
    // =================================================================
    getCollectedStatuses() {
      // מחזיר את כל הסטטוסים שנאספו
      return this._statuses;
    }

  /**
   * This function runs independently in the background.
   * It downloads and saves the media, then sends an update via socket.
   */
  private async processMessageMediaInBackground(message: WAWebJS.Message): Promise<void> {
    if (!message.hasMedia || message.type === 'revoked') {
      return;
    }

    // אם יש כבר mediaUrl, נשתמש בו
    if ((message as any).mediaUrl !== undefined) {
      this.socketService.send('media-ready', {
        messageId: message.id._serialized,
        mediaUrl: (message as any).mediaUrl,
      });
      return;
    }

    try {
      const media = await message.downloadMedia();

      if (!media || !media.data) {
        throw new Error('Media data is missing');
      }

      const fileExtension = media.mimetype.split('/')[1] || 'bin';
      const filename = `${message.timestamp}_${message.id.id}.${fileExtension}`;
      const chatId = message.fromMe ? message.to : message.from;
      const chatName = chatId.replace(/[^a-zA-Z0-9]/g, '_');
      const chatFolderPath = path.join(this.MEDIA_SAVE_PATH, chatName);
      const filePath = path.join(chatFolderPath, filename);
      const mediaUrl = `${this.BASE_URL}/media/${chatName}/${filename}`;

      if (!fs.existsSync(filePath)) {
        if (!fs.existsSync(chatFolderPath)) {
          fs.mkdirSync(chatFolderPath, { recursive: true });
        }
        fs.writeFileSync(filePath, media.data, 'base64');
        this._logger.log(`Media processed and saved: ${filePath}`);
      }

      // עדכון ה-mediaUrl על ההודעה עצמה
      (message as any).mediaUrl = mediaUrl;

      // ★ Critical step: Send the update to the client via WebSocket
      // The name of the event is 'media-ready'
      this.socketService.send('media-ready', {
        messageId: message.id._serialized,
        mediaUrl: mediaUrl,
      });

    } catch (err) {
      this._logger.error(`Failed to process media in background for message ${message.id.id}: ${err.message}`);
      // You can also send an error event to the client if you want
      this.socketService.send('media-error', {
        messageId: message.id._serialized,
      });
    }
  }
}
