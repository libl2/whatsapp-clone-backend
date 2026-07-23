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

const { Message: WAWebJSMessage } = require('whatsapp-web.js');

@Injectable()
export class AppService {
  private _logger = new ConsoleLogger('AppService');
  private readonly MEDIA_SAVE_PATH = path.join(__dirname, '..', '..', 'media');
  private readonly BASE_URL = 'http://localhost:3100';
  private _statusIds = new Set<string>();
  private _mediaUrlCache = new Map<string, string>();
  private _mediaProcessing = new Set<string>();
  private _statusListenerBound = false;
  private _statuses: any[] = []; // ׳©׳׳™׳¨׳× ׳¡׳˜׳˜׳•׳¡׳™׳ ׳‘׳–׳™׳›׳¨׳•׳

  constructor(
    private readonly waService: WhatsAppService,
    private readonly socketService: SocketService, // Injecting the SocketService
  ) {
    if (!fs.existsSync(this.MEDIA_SAVE_PATH)) {
      fs.mkdirSync(this.MEDIA_SAVE_PATH, { recursive: true });
    }
    // ׳׳ ׳׳׳–׳™׳ ׳™׳ ׳›׳׳! ׳”׳”׳׳–׳ ׳” ׳×׳×׳‘׳¦׳¢ ׳׳—׳¨׳™ ׳©׳”-client ׳׳•׳›׳
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
   * ׳׳׳–׳™׳ ׳׳”׳•׳“׳¢׳•׳× ׳¡׳˜׳˜׳•׳¡ ׳׳—׳¨׳™ ׳©׳”-client ׳׳•׳›׳
   */
  private setupStatusListener() {
    if (this._statusListenerBound) {
      this._logger.warn('Status listener already set up; skipping duplicate registration');
      return;
    }

    if (!this.waService.client) {
      this._logger.error('WhatsApp client is not initialized!');
      return;
    }

    this._statusListenerBound = true;

    this.waService.client.on('message', async (message: WAWebJS.Message) => {
      // ׳–׳™׳”׳•׳™ ׳”׳•׳“׳¢׳× ׳¡׳˜׳˜׳•׳¡ ׳׳₪׳™ ׳”׳©׳•׳׳—
      if (message.from === 'status@broadcast') {
        // ׳ ׳¡׳™׳•׳ ׳׳׳¦׳™׳׳× ׳׳–׳”׳” ׳”׳©׳•׳׳— ׳׳׳§׳•׳¨׳•׳× ׳©׳•׳ ׳™׳ ׳‘׳”׳•׳“׳¢׳”
        let contactId = this.extractContactId(message);
        let contactName: string = null;
        let contactAvatar: string = null;

        if (contactId) {
          // sanitize id: ׳׳ ׳—׳¡׳¨ suffix, ׳”׳•׳¡׳£ @c.us
          if (!contactId.includes('@')) {
            contactId = `${contactId}@c.us`;
          }

          let resolvedName: string = null;
          const msg = message as any; // Cast to any to access undocumented fields

          // 1) FIRST: try notifyName from the message itself (׳–׳”׳• ׳”׳©׳ ׳©׳׳•׳¦׳’ ׳¢׳ ׳”׳¡׳˜׳˜׳•׳¡)
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
          // ׳׳ ׳”׳¦׳׳—׳ ׳• ׳׳—׳׳¥ id ג€” ׳ ׳¡׳₪׳§ fallback ׳›׳׳׳™
          contactId = null;
          contactName = 'Unknown contact';
          contactAvatar = null;
        }

        // ׳¢׳™׳‘׳•׳“ ׳׳“׳™׳” ׳׳ ׳™׳©
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

        const uniqueStatusId = `${statusItem.id}::${contactId || 'unknown'}::${statusItem.timestamp || 0}`;
        if (this._statusIds.has(uniqueStatusId)) {
          return;
        }
        this._statusIds.add(uniqueStatusId);

        // ׳©׳׳™׳¨׳” ׳‘׳–׳™׳›׳¨׳•׳
        this._statuses.push(statusItem);

        // ׳©׳׳™׳—׳” ׳׳׳§׳•׳— ׳“׳¨׳ ׳¡׳•׳§׳˜
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
    try {
      return await this.waService.client.getProfilePicUrl(id);
    } catch (err) {
      this._logger.warn(`getAvatar failed for ${id}: ${err?.message || err}`);
      return null;
    }
  }

  async getChats(): Promise<WAWebJS.Chat[]> {
    this.ensureClientReady('getChats');
    return await this.waService.client.getChats({ skipMetadata: true });
  }

  async getChat(id: string): Promise<WAWebJS.Chat> {
    this.ensureClientReady('getChat');
    return await this.waService.client.getChatById(id);
  }

  async getMessages(id: string, model: any): Promise<WAWebJS.Message[]> {
    this.ensureClientReady('getMessages');
    try {
      const chat = await this.waService.client.getChatById(id, { skipMetadata: true });
      let messages: WAWebJS.Message[];

      try {
        messages = await chat.fetchMessages(model);
      } catch (err) {
        if (!this.isRecoverableFetchMessagesError(err)) {
          throw err;
        }

        this._logger.warn(
          `fetchMessages failed for ${id}, using loaded-messages fallback: ${err?.message || err}`,
        );
        messages = await this.getLoadedMessagesFallback(id, model);
      }

      // Run media processing in the background without waiting
      messages.forEach(message => {
        if (message.hasMedia) {
          this.processMessageMediaInBackground(message); // Call without await
        }
      });

      // Return messages immediately
      return await Promise.all(messages.map((message) => this.serializeMessage(message)));
    } catch (err) {
      this._logger.error(`Error fetching messages for chat ${id}: ${err.message}`);
      throw err;
    }
  }

  private isRecoverableFetchMessagesError(err: any): boolean {
    const message = String(err?.message || err || '');
    return (
      message.includes('waitForChatLoading') ||
      message.includes('Cannot read properties of undefined')
    );
  }

  private async getLoadedMessagesFallback(id: string, model: any): Promise<WAWebJS.Message[]> {
    const client = this.waService.client as any;
    const rawMessages = await client.pupPage.evaluate(async (chatId, searchOptions) => {
      const wwebjs = (window as any).WWebJS;

      const msgFilter = (m) => {
        if (m.isNotification || m.type === 'newsletter_notification') {
          return false;
        }
        if (searchOptions && searchOptions.fromMe !== undefined && m.id.fromMe !== searchOptions.fromMe) {
          return false;
        }
        return true;
      };

      const chat = await wwebjs.getChat(chatId, { getAsModel: false });
      if (!chat?.msgs) {
        return [];
      }

      let msgs = chat.msgs.getModelsArray().filter(msgFilter);
      msgs.sort((a, b) => (a.t > b.t ? 1 : -1));

      if (searchOptions && searchOptions.limit > 0 && msgs.length > searchOptions.limit) {
        msgs = msgs.slice(msgs.length - searchOptions.limit);
      }

      return msgs.map(m => wwebjs.getMessageModel(m));
    }, id, model);

    return rawMessages.map((message: any) => new WAWebJSMessage(this.waService.client, message));
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

      return await Promise.all(messages.map((message) => this.serializeMessage(message)));
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
        const message = await this.waService.client.sendMessage(id, model.message);
        return (await this.serializeMessage(message)) as any;
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
      const chat = await this.waService.client.getChatById(id, { skipMetadata: true });
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
      // ׳׳—׳–׳™׳¨ ׳׳× ׳›׳ ׳”׳¡׳˜׳˜׳•׳¡׳™׳ ׳©׳ ׳׳¡׳₪׳•
      return this._statuses;
    }

  private async serializeQuotedMessage(message: any): Promise<any | null> {
    const hasQuotedMsg = Boolean(message?.hasQuotedMsg ?? message?._data?.quotedMsg);
    if (!hasQuotedMsg) {
      return null;
    }

    try {
      const quoted = typeof message?.getQuotedMessage === 'function'
        ? await message.getQuotedMessage()
        : null;

      if (!quoted) {
        return null;
      }

      const data = quoted?._data || {};
      const body =
        typeof quoted?.body === 'string'
          ? quoted.body
          : typeof data?.body === 'string'
            ? data.body
            : '';

      return {
        id: quoted?.id?._serialized || quoted?.id?.id || quoted?.id || null,
        body,
        type: quoted?.type || data?.type || 'chat',
        from: quoted?.from || data?.from?._serialized || data?.from || null,
        author: quoted?.author || data?.author?._serialized || data?.author || null,
        fromMe: Boolean(quoted?.fromMe ?? data?.id?.fromMe),
        hasMedia: Boolean(quoted?.hasMedia),
        notifyName:
          typeof quoted?.notifyName === 'string'
            ? quoted.notifyName
            : typeof data?.notifyName === 'string'
              ? data.notifyName
              : null,
        _data: {
          notifyName: typeof data?.notifyName === 'string' ? data.notifyName : null,
          author: data?.author?._serialized || data?.author || null,
          sender: {
            name:
              typeof data?.senderObj?.name === 'string'
                ? data.senderObj.name
                : typeof data?.sender?.name === 'string'
                  ? data.sender.name
                  : null,
            pushname:
              typeof data?.senderObj?.pushname === 'string'
                ? data.senderObj.pushname
                : typeof data?.sender?.pushname === 'string'
                  ? data.sender.pushname
                  : null,
          },
        },
      };
    } catch (err) {
      this._logger.warn(`Failed to load quoted message: ${err?.message || err}`);
      return null;
    }
  }

  private async serializeMessage(message: any): Promise<any> {
    const data = message?._data || {};
    const rawBody =
      typeof message?.body === 'string'
        ? message.body
        : typeof data?.body === 'string'
          ? data.body
          : '';
    const caption =
      typeof data?.caption === 'string'
        ? data.caption
        : typeof message?.caption === 'string'
          ? message.caption
          : '';

    let body = caption || rawBody;
    if (message?.hasMedia && this.looksLikeEncodedPayload(body)) {
      body = caption || '';
    }

    const quotedMessage = await this.serializeQuotedMessage(message);

    return {
      id: message?.id,
      ack: message?.ack,
      hasMedia: Boolean(message?.hasMedia),
      body: typeof body === 'string' ? body : '',
      type: message?.type || data?.type || 'chat',
      timestamp: Number(message?.timestamp || data?.t || 0),
      from: message?.from || data?.from?._serialized || data?.from || null,
      to: message?.to || data?.to?._serialized || data?.to || null,
      author: message?.author || data?.author?._serialized || data?.author || null,
      fromMe: Boolean(message?.fromMe ?? data?.id?.fromMe),
      notifyName:
        typeof message?.notifyName === 'string'
          ? message.notifyName
          : typeof data?.notifyName === 'string'
            ? data.notifyName
            : null,
      mediaUrl: (message as any)?.mediaUrl ?? null,
      mimetype: data?.mimetype || null,
      filename: data?.filename || null,
      duration: message?.duration ?? data?.duration ?? null,
      quotedMessage,
      _data: {
        notifyName: typeof data?.notifyName === 'string' ? data.notifyName : null,
        author: data?.author?._serialized || data?.author || null,
        sender: {
          name:
            typeof data?.senderObj?.name === 'string'
              ? data.senderObj.name
              : typeof data?.sender?.name === 'string'
                ? data.sender.name
                : null,
          pushname:
            typeof data?.senderObj?.pushname === 'string'
              ? data.senderObj.pushname
              : typeof data?.sender?.pushname === 'string'
                ? data.sender.pushname
                : null,
        },
      },
    };
  }

  private looksLikeEncodedPayload(value: string): boolean {
    if (!value || typeof value !== 'string') {
      return false;
    }

    const compact = value.replace(/\s+/g, '');
    return compact.length > 120 && /^[A-Za-z0-9+/=_-]+$/.test(compact);
  }

  /**
   * This function runs independently in the background.
   * It downloads and saves the media, then sends an update via socket.
   */
  private async processMessageMediaInBackground(message: WAWebJS.Message): Promise<void> {
    if (!message.hasMedia || message.type === 'revoked') {
      return;
    }

    const serializedId = message.id?._serialized;
    if (!serializedId) {
      this._logger.warn(`processMessageMediaInBackground: message has no serialized id, skipping media download (type=${message.type})`);
      return;
    }

    const cachedUrl = this._mediaUrlCache.get(serializedId);
    if (cachedUrl) {
      // already downloaded earlier in this process's lifetime; re-notify this
      // (likely newly-mounted) listener instead of silently doing nothing
      this.socketService.send('media-ready', {
        messageId: serializedId,
        mediaUrl: cachedUrl,
      });
      return;
    }

    if (this._mediaProcessing.has(serializedId)) {
      return;
    }

    // ׳׳ ׳™׳© ׳›׳‘׳¨ mediaUrl, ׳ ׳©׳×׳׳© ׳‘׳•
    if ((message as any).mediaUrl !== undefined) {
      this._mediaUrlCache.set(serializedId, (message as any).mediaUrl);
      this.socketService.send('media-ready', {
        messageId: serializedId,
        mediaUrl: (message as any).mediaUrl,
      });
      return;
    }

    const chatId = message.fromMe ? message.to : message.from;
    const chatName = chatId.replace(/[^a-zA-Z0-9]/g, '_');
    const chatFolderPath = path.join(this.MEDIA_SAVE_PATH, chatName);
    const existingFile = this.findExistingMediaFile(chatFolderPath, message.timestamp, message.id.id);
    if (existingFile) {
      // already downloaded in a previous run of the backend; the in-memory
      // cache was empty (e.g. after a restart) but the file is already on disk
      const mediaUrl = `${this.BASE_URL}/media/${chatName}/${existingFile}`;
      this._mediaUrlCache.set(serializedId, mediaUrl);
      this.socketService.send('media-ready', { messageId: serializedId, mediaUrl });
      return;
    }

    this._mediaProcessing.add(serializedId);

    try {
      const media = await this.downloadMediaWithRetries(message, serializedId);

      if (!media || !media.data) {
        throw new Error('Media data is missing');
      }

      const fileExtension = media.mimetype.split('/')[1] || 'bin';
      const filename = `${message.timestamp}_${message.id.id}.${fileExtension}`;
      const filePath = path.join(chatFolderPath, filename);
      const mediaUrl = `${this.BASE_URL}/media/${chatName}/${filename}`;

      if (!fs.existsSync(filePath)) {
        if (!fs.existsSync(chatFolderPath)) {
          fs.mkdirSync(chatFolderPath, { recursive: true });
        }
        fs.writeFileSync(filePath, media.data, 'base64');
        this._logger.log(`Media processed and saved: ${filePath}`);
      }

      // ׳¢׳“׳›׳•׳ ׳”-mediaUrl ׳¢׳ ׳”׳”׳•׳“׳¢׳” ׳¢׳¦׳׳”
      (message as any).mediaUrl = mediaUrl;
      this._mediaUrlCache.set(serializedId, mediaUrl);

      // ג˜… Critical step: Send the update to the client via WebSocket
      // The name of the event is 'media-ready'
      this.socketService.send('media-ready', {
        messageId: serializedId,
        mediaUrl: mediaUrl,
      });

    } catch (err) {
      this._logger.error(`Failed to process media in background for message ${message.id.id}: ${err.message}`);
      // You can also send an error event to the client if you want
      this.socketService.send('media-error', {
        messageId: message.id._serialized,
      });
    } finally {
      this._mediaProcessing.delete(serializedId);
    }
  }

  private findExistingMediaFile(chatFolderPath: string, timestamp: number, messageId: string): string | null {
    if (!fs.existsSync(chatFolderPath)) {
      return null;
    }
    const prefix = `${timestamp}_${messageId}.`;
    const match = fs.readdirSync(chatFolderPath).find((name) => name.startsWith(prefix));
    return match || null;
  }

  // Video (and sometimes large image) media can still be resolving on WhatsApp's
  // side right after it arrives; a single attempt often fails even though a
  // retry a few seconds later succeeds. Retry a few times before giving up.
  private async downloadMediaWithRetries(message: WAWebJS.Message, serializedId: string): Promise<any> {
    const delaysMs = [5000, 15000];
    let lastErr: any;

    for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
      try {
        const media = await message.downloadMedia();
        if (media && media.data) {
          return media;
        }
        lastErr = new Error('Media data is missing');
      } catch (err) {
        lastErr = err;
      }

      if (attempt < delaysMs.length) {
        this._logger.warn(
          `downloadMedia attempt ${attempt + 1} failed for ${serializedId}, retrying in ${delaysMs[attempt]}ms: ${lastErr?.message || lastErr}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
      }
    }

    throw lastErr;
  }
}




