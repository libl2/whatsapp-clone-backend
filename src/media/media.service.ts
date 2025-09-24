import { ConsoleLogger, Injectable } from '@nestjs/common';
import WAWebJS from 'whatsapp-web.js';
import * as fs from 'fs';
import * as path from 'path';
import { SocketService } from '../socket/socket.service';

@Injectable()
export class MediaService {
  private _logger = new ConsoleLogger('MediaService');
  private readonly MEDIA_SAVE_PATH = path.join(__dirname, '..', '..', 'media');

  constructor(private readonly socketService: SocketService) {
    // ודא שתיקיית המדיה הראשית קיימת
    if (!fs.existsSync(this.MEDIA_SAVE_PATH)) {
      fs.mkdirSync(this.MEDIA_SAVE_PATH, { recursive: true });
    }
  }

  /**
   * מוריד מדיה מהודעה ושומר אותה בתיקייה ייעודית לצ'אט.
   * פונקציה זו רצה באופן אסינכרוני.
   * @param message ההודעה המכילה מדיה.
   * @param initialMediaMetadata מטא-דאטה ראשוני של המדיה.
   */
  async downloadMediaAsync(message: WAWebJS.Message, initialMediaMetadata: { mimetype: string, filename: string, isDownloaded: boolean }) {
    // נשתמש ב-setImmediate כדי לוודא שהפונקציה רצה ברקע ואינה חוסמת את התהליך הראשי
    setImmediate(async () => {
      if (!message.hasMedia) {
        return;
      }

      // בדוק אם הקובץ כבר ירד כדי למנוע הורדות מיותרות
      if (initialMediaMetadata.isDownloaded) {
        return;
      }

      try {
        this._logger.log(`Attempting to download media for message ${message.id.id} from chat ${message.from}`);
        const media = await message.downloadMedia();
        if (media && media.data) {
          const fileExtension = media.mimetype.split('/')[1] || 'bin';
          const filename = `${message.timestamp}_${message.id.id}.${fileExtension}`;
          
          const chatName = this.getChatFolderName(message.from);
          const chatFolderPath = path.join(this.MEDIA_SAVE_PATH, chatName);

          if (!fs.existsSync(chatFolderPath)) {
            fs.mkdirSync(chatFolderPath, { recursive: true });
          }

          const filePath = path.join(chatFolderPath, filename);

          fs.writeFileSync(filePath, media.data, 'base64');
          this._logger.log(`Media downloaded: ${filePath}`);

          // לאחר שהמדיה ירדה, נשלח עדכון ל-frontend דרך WebSocket
          const localMediaUrl = `/media/${chatName}/${filename}`;
          this.socketService.send('media_downloaded', {
            messageId: message.id.id,
            chatId: message.from, 
            localMediaUrl: localMediaUrl,
            mimetype: media.mimetype,
            filename: filename,
          });
        } else {
          this._logger.warn(`No media data received for message ${message.id.id} after downloadMedia()`);
        }
      } catch (err) {
        this._logger.error(`Failed to download media for message ${message.id.id}: ${err.message}`);
      }
    });
  }

  /**
   * שולף מטא-דאטה של מדיה (mimetype, filename) ומציין אם הקובץ כבר קיים מקומית.
   * זה לא מוריד את הקובץ עצמו לדיסק, אלא מביא את המטא-דאטה ואת נתוני ה-Base64 מה-WhatsApp client.
   * @param message ההודעה המכילה מדיה.
   * @returns אובייקט עם mimetype, filename, ו-isDownloaded, או null אם אין מדיה.
   */
  async getMediaMetadata(message: WAWebJS.Message): Promise<{ mimetype: string, filename: string, isDownloaded: boolean } | null> {
    if (!message.hasMedia) {
      return null;
    }

    try {
      const media = await message.downloadMedia(); 
      if (media && media.mimetype) {
        const fileExtension = media.mimetype.split('/')[1] || 'bin';
        const filename = `${message.timestamp}_${message.id.id}.${fileExtension}`;
        const isDownloaded = this.checkIfMediaExistsLocallyByFilename(message.from, filename);
        return { mimetype: media.mimetype, filename, isDownloaded };
      }
    } catch (err) {
      this._logger.warn(`Could not retrieve media metadata for message ${message.id.id} (Error: ${err.message}). Using fallback.`);
    }
    // אם נכשלנו, נחזיר ערכי ברירת מחדל
    return { mimetype: 'application/octet-stream', filename: `${message.timestamp}_${message.id.id}.bin`, isDownloaded: false };
  }

  /**
   * בודק אם קובץ מדיה עבור צ'אט ושם קובץ ספציפיים כבר קיים מקומית.
   * @param chatId מזהה הצ'אט.
   * @param filename שם הקובץ הצפוי.
   * @returns true אם הקובץ קיים, false אחרת.
   */
  private checkIfMediaExistsLocallyByFilename(chatId: string, filename: string): boolean {
    const chatName = this.getChatFolderName(chatId);
    const filePath = path.join(this.MEDIA_SAVE_PATH, chatName, filename);
    return fs.existsSync(filePath);
  }

  /**
   * מייצר שם תיקייה בטוח ממזהה הצ'אט.
   * @param chatId מזהה הצ'אט.
   * @returns שם תיקייה בטוח.
   */
  private getChatFolderName(chatId: string): string {
    return chatId.replace(/[^a-zA-Z0-9]/g, '_');
  }
}
