// C:\Users\user\Documents\wa-web\WhatsppWeb-React\whatsapp-clone-backend\src\app\app.service.ts
import { ConsoleLogger, Injectable } from '@nestjs/common';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import WAWebJS from 'whatsapp-web.js';
import * as fs from 'fs';
import * as path from 'path';
import { SocketService } from 'src/socket/socket.service'; // וודא שאתה מייבא את SocketService

@Injectable()
export class AppService {
  private _logger = new ConsoleLogger('AppService');
  private readonly MEDIA_SAVE_PATH = path.join(__dirname, '..', '..', 'media'); 

  constructor(
    private readonly waService: WhatsAppService,
    private readonly socketService: SocketService // הזרקת SocketService
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

      // עבור כל הודעה, נטפל במדיה באופן אסינכרוני
      // ונחזיר את המידע הבסיסי של ההודעה מיד.
      const processedMessages = messages.map(message => {
        if (message.hasMedia) {
          // נפעיל את ההורדה ברקע, לא נחכה לה
          this.downloadMediaAsync(message);
          
          // נוסיף לאובייקט ההודעה מידע שימושי ל-frontend
          // ה-frontend ישתמש ב-mimetype כדי לדעת מה להציג (תמונה/וידאו/קובץ)
          // ואת isDownloaded כדי לדעת אם הקובץ כבר קיים אצלנו
          const mediaInfo = {
            mimetype: message.mimetype,
            filename: message.filename,
            isDownloaded: this.checkIfMediaExistsLocally(message) // בדיקה מהירה אם הקובץ קיים
          };
          // נחזיר אובייקט הודעה עם מידע על המדיה
          return { ...message, _mediaInfo: mediaInfo } as any; 
        }
        return message;
      });

      return processedMessages;
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

      const processedMessages = messages.map(message => {
        if (message.hasMedia) {
          this.downloadMediaAsync(message);
          const mediaInfo = {
            mimetype: message.mimetype,
            filename: message.filename,
            isDownloaded: this.checkIfMediaExistsLocally(message)
          };
          return { ...message, _mediaInfo: mediaInfo } as any;
        }
        return message;
      });

      return processedMessages;
    } catch (err) {
      this._logger.error(`Error searching messages: ${err.message}`);
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
   * פונקציה זו רצה באופן אסינכרוני.
   * @param message ההודעה המכילה מדיה.
   */
  private async downloadMediaAsync(message: WAWebJS.Message) {
    // נשתמש ב-setImmediate כדי לוודא שהפונקציה רצה ברקע ואינה חוסמת את התהליך הראשי
    setImmediate(async () => {
      if (!message.hasMedia) {
        return;
      }

      // בדוק אם הקובץ כבר ירד כדי למנוע הורדות מיותרות
      if (this.checkIfMediaExistsLocally(message)) {
        this._logger.log(`Media for message ${message.id.id} already exists locally. Skipping download.`);
        return;
      }

      try {
        this._logger.log(`Attempting to download media for message ${message.id.id}`);
        const media = await message.downloadMedia();
        if (media) {
          const fileExtension = media.mimetype.split('/')[1] || 'bin'; // סיומת ברירת מחדל
          const filename = `${message.timestamp}_${message.id.id}.${fileExtension}`;
          
          const chatName = this.getChatFolderName(message.from); // פונקציה לייצור שם תיקייה
          const chatFolderPath = path.join(this.MEDIA_SAVE_PATH, chatName);

          if (!fs.existsSync(chatFolderPath)) {
            fs.mkdirSync(chatFolderPath, { recursive: true });
          }

          const filePath = path.join(chatFolderPath, filename);

          fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
          this._logger.log(`Media downloaded: ${filePath}`);

          // לאחר שהמדיה ירדה, נשלח עדכון ל-frontend דרך WebSocket
          const localMediaUrl = `/media/${chatName}/${filename}`; // הנתיב הנגיש מה-frontend
          this.socketService.send('media_downloaded', {
            messageId: message.id.id,
            chatId: message.from, // או message.to, תלוי בצורך
            localMediaUrl: localMediaUrl,
            mimetype: media.mimetype,
            filename: filename,
          });
        } else {
            this._logger.warn(`No media data received for message ${message.id.id}`);
        }
      } catch (err) {
        this._logger.error(`Failed to download media for message ${message.id.id}: ${err.message}`);
      }
    });
  }

  /**
   * בודק אם קובץ מדיה עבור הודעה מסוימת כבר קיים מקומית.
   * @param message ההודעה לבדיקה.
   * @returns true אם הקובץ קיים, false אחרת.
   */
  private checkIfMediaExistsLocally(message: WAWebJS.Message): boolean {
    if (!message.hasMedia || !message.mimetype) { // נוודא שיש mimetype לפני שממשיכים
      return false;
    }
    const fileExtension = message.mimetype.split('/')[1] || 'bin';
    const filename = `${message.timestamp}_${message.id.id}.${fileExtension}`;
    const chatName = this.getChatFolderName(message.from);
    const filePath = path.join(this.MEDIA_SAVE_PATH, chatName, filename);
    return fs.existsSync(filePath);
  }

  /**
   * מייצר שם תיקייה בטוח מזהה הצ'אט.
   * @param chatId מזהה הצ'אט.
   * @returns שם תיקייה בטוח.
   */
  private getChatFolderName(chatId: string): string {
    return chatId.replace(/[^a-zA-Z0-9]/g, '_');
  }
}