import { ConsoleLogger, Injectable } from '@nestjs/common';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import WAWebJS from 'whatsapp-web.js';
import * as fs from 'fs';
import * as path from 'path';
import { SocketService } from '../socket/socket.service'; // ודא שהנתיב נכון

@Injectable()
export class AppService {
  private _logger = new ConsoleLogger('AppService');
  private readonly MEDIA_SAVE_PATH = path.join(__dirname, '..', '..', 'media');
  private readonly BASE_URL = 'http://localhost:3100';

  constructor(
    private readonly waService: WhatsAppService,
    private readonly socketService: SocketService, // הזרקת שירות הסוקט
  ) {
    if (!fs.existsSync(this.MEDIA_SAVE_PATH)) {
      fs.mkdirSync(this.MEDIA_SAVE_PATH, { recursive: true });
    }
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
      });
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

      await Promise.all(messages.map(message => this.processMessageMedia(message)));

      return messages;
    } catch (err) {
      this._logger.error(`Error fetching messages for chat ${id}: ${err.message}`);
      return [];
    }
  }

  async searchMessages(model: any): Promise<WAWebJS.Message[]> {
    try {
      const messages = await this.waService.client.searchMessages(model.query, {
        chatId: model.chatId,
        page: model.page,
        limit: model.limit,
      });
      
      await Promise.all(messages.map(message => this.processMessageMedia(message)));

      return messages;
    } catch (err) {
      this._logger.error(`Error searching messages: ${err.message}`);
      return [];
    }
  }

  async sendMessage(id: string, model: any): Promise<WAWebJS.Message> {
    try {
      if (model.message) {
        return await this.waService.client.sendMessage(id, model.message);
      }
      throw new Error('Method not implemented for this model.');
    } catch (err) {
      return undefined;
    }
  }

  getStatus() {
    return {
      whatsapp: this.waService.status,
    };
  }

  /**
   * פונקציית עזר מרכזית לטיפול במדיה.
   */
  private async processMessageMedia(message: WAWebJS.Message): Promise<void> {
    if (!message.hasMedia || message.type === 'revoked') {
      return;
    }

    try {
      const media = await message.downloadMedia();

      // === התיקון שהוספנו ===
      // בדיקה חיונית כדי לוודא שקיבלנו אובייקט מדיה תקין
      if (!media || !media.data) {
        this._logger.warn(`Could not retrieve media data for message ${message.id.id}`);
        (message as any).mediaError = true;
        return; // יציאה בטוחה מהפונקציה
      }
      // =======================

      const fileExtension = media.mimetype.split('/')[1] || 'bin';
      const filename = `${message.timestamp}_${message.id.id}.${fileExtension}`;
      
      const chatId = message.fromMe ? message.to : message.from;
      const chatName = chatId.replace(/[^a-zA-Z0-9]/g, '_');
      
      const chatFolderPath = path.join(this.MEDIA_SAVE_PATH, chatName);
      const filePath = path.join(chatFolderPath, filename);

      (message as any).mediaUrl = `${this.BASE_URL}/media/${chatName}/${filename}`;

      if (!fs.existsSync(filePath)) {
        if (!fs.existsSync(chatFolderPath)) {
          fs.mkdirSync(chatFolderPath, { recursive: true });
        }
        
        fs.writeFileSync(filePath, media.data, 'base64');
        this._logger.log(`Media downloaded and saved: ${filePath}`);
      }
      
    } catch (err) {
      this._logger.error(`Failed to process media for message ${message.id.id}: ${err.message}`);
      (message as any).mediaUrl = null;
      (message as any).mediaError = true;
    }
  }
}