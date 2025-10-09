import { ConsoleLogger, Injectable } from '@nestjs/common';
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
        // עיבוד מדיה אם יש
        if (message.hasMedia) {
          await this.processMessageMediaInBackground(message);
        }
        // שמירה בזיכרון
        this._statuses.push({
          id: message.id._serialized,
          from: message.from,
          timestamp: message.timestamp,
          body: message.body,
          mediaUrl: (message as any).mediaUrl || null,
        });
        // אפשר לשלוח דרך סוקט אם רוצים
        this.socketService.send('status-update', {
          id: message.id._serialized,
          from: message.from,
          timestamp: message.timestamp,
          body: message.body,
          mediaUrl: (message as any).mediaUrl || null,
        });
      }
    });
    this._logger.log('Status listener is set up!');
  }

  getQR() {
    return this.waService.qr;
  }

  async getAvatar(id: string): Promise<string> {
    try {
      return await this.waService.client.getProfilePicUrl(id);
    } catch (err) {
      return '';
    }
  }

  async getChats(): Promise<WAWebJS.Chat[]> {
    try {
      return await this.waService.client.getChats();
    } catch (err) {
      return [];
    }
  }

  async getMessages(id: string, model: any): Promise<WAWebJS.Message[]> {
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
      return [];
    }
  }
  
  // =================================================================
  // RESTORED METHOD 1: searchMessages
  // =================================================================
  async searchMessages(model: any): Promise<WAWebJS.Message[]> {
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
      return [];
    }
  }

  // =================================================================
  // RESTORED METHOD 2: sendMessage
  // =================================================================
  async sendMessage(id: string, model: any): Promise<WAWebJS.Message> {
    try {
      if (model.message) {
        return await this.waService.client.sendMessage(id, model.message);
      }
      throw new Error('Message content is missing in the model.');
    } catch (err) {
        this._logger.error(`Failed to send message to ${id}: ${err.message}`);
      return undefined;
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