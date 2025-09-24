import { ConsoleLogger, Injectable, OnModuleInit } from '@nestjs/common';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import WAWebJS from 'whatsapp-web.js';
import { MediaService } from '../media/media.service';

@Injectable()
export class AppService implements OnModuleInit {
  private _logger = new ConsoleLogger('AppService');

  constructor(
    private readonly waService: WhatsAppService,
    private readonly mediaService: MediaService
  ) {}

  async onModuleInit() {
    this._logger.log('AppService initialized - starting WhatsApp client');
    this.init();
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
      if (!this.waService.isClientReady) {
        this._logger.warn(`WhatsApp client is not ready yet (status: ${this.waService.status})`);
        return '';
      }
      return await this.waService.client.getProfilePicUrl(id);
    } catch (err) {
      this._logger.error(`Error getting avatar for ${id}: ${err.message}`);
      return '';
    }    
  }

  async getChats(): Promise<WAWebJS.Chat[]> {
    try {
      if (!this.waService.isClientReady) {
        this._logger.warn(`WhatsApp client is not ready yet (status: ${this.waService.status})`);
        return [];
      }
      return await this.waService.client.getChats();
    } catch (err) {
      this._logger.error(`Error getting chats: ${err.message}`);
      return [];
    }
  }

  async getMessages(id: string, model: any): Promise<WAWebJS.Message[]> {
    try {
      if (!this.waService.isClientReady) {
        this._logger.warn(`WhatsApp client is not ready yet (status: ${this.waService.status})`);
        return [];
      }
      const chat = await this.waService.client.getChatById(id);
      const messages = await chat.fetchMessages(model);

      const processedMessages = await Promise.all(messages.map(async message => {
        if (message.hasMedia) {
          const mediaMetadata = await this.mediaService.getMediaMetadata(message);
          if (mediaMetadata) {
            this.mediaService.downloadMediaAsync(message, mediaMetadata);
            return { 
                ...message, 
                _mediaInfo: {
                  mimetype: mediaMetadata.mimetype,
                  filename: mediaMetadata.filename,
                  isDownloaded: mediaMetadata.isDownloaded,
                  localPath: mediaMetadata.isDownloaded ? `/media/${this.getChatFolderName(message.from)}/${mediaMetadata.filename}` : undefined
                } 
            } as any; 
          }
        }
        return message;
      }));

      return processedMessages;
    } catch (err) {
      this._logger.error(`Error fetching messages for chat ${id}: ${err.message}`);
      return [];
    }
  }

  async searchMessages(model: any): Promise<WAWebJS.Message[]> {
    try {
      if (!this.waService.isClientReady) {
        this._logger.warn(`WhatsApp client is not ready yet (status: ${this.waService.status})`);
        return [];
      }
      const messages = await this.waService.client.searchMessages(model.query, {
        chatId: model.chatId,
        page: model.page,
        limit: model.limit,
      });

      const processedMessages = await Promise.all(messages.map(async message => {
        if (message.hasMedia) {
          const mediaMetadata = await this.mediaService.getMediaMetadata(message);
          if (mediaMetadata) {
            this.mediaService.downloadMediaAsync(message, mediaMetadata);
            return { 
                ...message, 
                _mediaInfo: {
                  mimetype: mediaMetadata.mimetype,
                  filename: mediaMetadata.filename,
                  isDownloaded: mediaMetadata.isDownloaded,
                  localPath: mediaMetadata.isDownloaded ? `/media/${this.getChatFolderName(message.from)}/${mediaMetadata.filename}` : undefined
                } 
            } as any;
          }
        }
        return message;
      }));

      return processedMessages;
    } catch (err) {
      this._logger.error(`Error searching messages: ${err.message}`);
      return [];
    }
  }

  async sendMessage(id: string, model: any): Promise<WAWebJS.Message> {
    try {
      if (!this.waService.isClientReady) {
        this._logger.warn(`WhatsApp client is not ready yet (status: ${this.waService.status})`);
        return undefined;
      }
      if (model.message) {
        return await this.waService.client.sendMessage(id, {
          body: model.message,
        } as any); 
      }
      throw new Error('Method not implemented: Message content is empty.');
    } catch (err) {
      this._logger.error(`Error sending message to ${id}: ${err.message}`);
      return undefined;
    }
  }

  getStatus() {
    return {
      whatsapp: this.waService.status,
    };
  }

  // פונקציות עזר שנחשפות ל-MediaService
  async getMediaMetadata(message: WAWebJS.Message) {
    return await this.mediaService.getMediaMetadata(message);
  }

  async downloadMediaAsync(message: WAWebJS.Message, mediaMetadata: any) {
    return await this.mediaService.downloadMediaAsync(message, mediaMetadata);
  }

  private getChatFolderName(chatId: string): string {
    return chatId.replace(/[^a-zA-Z0-9]/g, '_');
  }
}
