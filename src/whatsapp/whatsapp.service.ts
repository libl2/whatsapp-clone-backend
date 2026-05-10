import { ConsoleLogger, Injectable } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
import { toDataURL } from 'qrcode';
import { SocketService } from '../socket/socket.service';

@Injectable()
export class WhatsAppService {
  client: Client;
  private _logger = new ConsoleLogger('WAService');
  private _qrCode = '';
  status: string = 'initializing';
  private _readyWatchdog: NodeJS.Timeout | null = null;
  private _lastState: string | null = null;

  constructor(private readonly socketService: SocketService) {}

  get qr(): string {
    return this._qrCode;
  }

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
    this.client.on('message', this.onMessage);
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

  private startReadyWatchdog(): void {
    if (this._readyWatchdog) {
      clearInterval(this._readyWatchdog);
    }

    this._readyWatchdog = setInterval(async () => {
      if (!this.client) {
        return;
      }

      try {
        const state = (await this.client.getState()) as string;
        if (state && state !== this._lastState) {
          this._lastState = state;
          this._logger.log(`WA state: ${state}`);
        }

        // Fallback for cases where "ready" event is not emitted.
        if (state === 'CONNECTED' && this.status !== 'ready') {
          this._logger.warn('Ready event missing; promoting CONNECTED state to ready');
          this.onReady();
        }
      } catch (err) {
        this._logger.warn(`Ready watchdog getState failed: ${err?.message || err}`);
      }
    }, 3000);
  }

  private stopReadyWatchdog(): void {
    if (this._readyWatchdog) {
      clearInterval(this._readyWatchdog);
      this._readyWatchdog = null;
    }
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

  private async serializeRealtimeMessage(message: any): Promise<any> {
    const data = message?._data || {};
    const rawBody =
      typeof message?.body === 'string'
        ? message.body
        : typeof data?.body === 'string'
          ? data.body
          : '';
    const caption = typeof data?.caption === 'string' ? data.caption : '';
    const compactBody = (caption || rawBody || '').replace(/\s+/g, '');
    const body =
      message?.hasMedia && compactBody.length > 120 && /^[A-Za-z0-9+/=_-]+$/.test(compactBody)
        ? caption || ''
        : caption || rawBody;
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

  private onQR = async (qr: string) => {
    this.status = 'qr';
    this._qrCode = await toDataURL(qr);
    this.socketService.send('qr', { qr: this._qrCode });
    this._logger.log('QR code sent to client');
  };
  private onReady = () => {
    this.status = 'ready';
    this._qrCode = '';
    this.stopReadyWatchdog();
    this.socketService.send('ready');
    this._logger.log('Client is ready');
  };
  private onAuthenticated = () => {
    this.status = 'authenticated';
    this.startReadyWatchdog();
    this.socketService.send('authenticated');
    this._logger.log('Client is authenticated');
  };
  private onAuthFailure = (msg) => {
    this.status = 'auth_failure';
    this.stopReadyWatchdog();
    this.socketService.send('authentication_failed');
    this._logger.log('Client is authentication failed', msg);
  };
  private onLoadingScreen = (percent, msg) => {
    this.socketService.send('loading', { percent, msg });
    this._logger.log(`Client is loading: ${percent}; ${msg}`);
  };
  private onMessage = async (msg) => {
    this.socketService.send('message', { msg: await this.serializeRealtimeMessage(msg) });
    this._logger.log(`Message has been recived: ${msg}`, msg);
  };
  private onMessageCreate = (msg) => {
    this._logger.log('onMessageCreate', msg);
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
    this.stopReadyWatchdog();
    this._logger.log('onDisconnected', reason);
  };
  private onContactChanged = (message, oldId, newId, isContact) => {
    this._logger.log('onContactChanged', message, oldId, newId, isContact);
  };
}
