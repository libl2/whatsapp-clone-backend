import { ConsoleLogger, Injectable } from '@nestjs/common';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import WAWebJS from 'whatsapp-web.js';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AppService {
  private _logger = new ConsoleLogger('AppService');
  private readonly MEDIA_SAVE_PATH = path.join(__dirname, '..', '..', 'media'); // נשמור תיקיית מדיה ב-root של ה-backend

  constructor(private readonly waService: WhatsAppService) {
    // ודא שתיקיית המדיה קיימת
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

      // לולאה על כל ההודעות כדי לבדוק ולטפל במדיה
      for (const message of messages) {
        if (message.hasMedia) {
          await this.downloadMedia(message);
        }
      }

      return messages;
    } catch (err) {
      this._logger.error(`Error fetching messages or downloading media for chat ${id}: ${err.message}`);
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

      for (const message of messages) {
        if (message.hasMedia) {
          await this.downloadMedia(message);
        }
      }

      return messages;
    } catch (err) {
      this._logger.error(`Error searching messages or downloading media: ${err.message}`);
      return [];
    }
  }

  async sendMessage(id: string, model: any): Promise<WAWebJS.Message> {
    try {
      if (model.message) {
        return await this.waService.client.sendMessage(id, {
          body: model.message,
          contentType: 'text',
        } as any);
      }
      throw new Error('Method not implemented.');
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
   * מוריד מדיה מהודעה ושומר אותה בתיקייה ייעודית לצ'אט.
   * @param message ההודעה המכילה מדיה.
   */
  private async downloadMedia(message: WAWebJS.Message) {
    try {
      const media = await message.downloadMedia();
      if (media) {
        // יצירת שם קובץ ייחודי (לדוגמה: timestamp_messageId.extension)
        const filename = `${message.timestamp}_${message.id.id}.${media.mimetype.split('/')[1]}`;
        
        // יצירת שם תיקייה עבור הצ'אט (מנקים תווים לא חוקיים)
        const chatName = message.from.replace(/[^a-zA-Z0-9]/g, '_'); 
        const chatFolderPath = path.join(this.MEDIA_SAVE_PATH, chatName);

        // ודא שתיקיית הצ'אט קיימת
        if (!fs.existsSync(chatFolderPath)) {
          fs.mkdirSync(chatFolderPath, { recursive: true });
        }

        const filePath = path.join(chatFolderPath, filename);

        // שמירת הקובץ
        fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
        this._logger.log(`Media downloaded: ${filePath}`);

        // ניתן להוסיף כאן לוגיקה לעדכון האובייקט message עם הנתיב המקומי של המדיה
        // כך שה-frontend יוכל להשתמש בו. לדוגמה:
        // (message as any).localMediaUrl = `/media/${chatName}/${filename}`; 
        // שימו לב: זה ידרוש הגדרה של serve-static ב-NestJS כדי שהקבצים יהיו נגישים.
      }
    } catch (err) {
      this._logger.error(`Failed to download media for message ${message.id.id}: ${err.message}`);
    }
  }
}