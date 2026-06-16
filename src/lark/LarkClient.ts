import {createLarkChannel, type LarkChannel, type LarkChannelError,} from '@larksuiteoapi/node-sdk';
import type {Logger} from 'pino';

import type {AppConfig} from '../config.js';
import {EventDispatcher, XEvent} from "../event/EventDispatcher.js";

export interface LarkEvent extends XEvent {
  type: 'message' | 'cardAction';
  payload: unknown;
}

export class LarkClient {
  private readonly channel: LarkChannel;

  private connected = false;

  constructor(
    config: AppConfig['lark'],
    private readonly eventDispatcher: EventDispatcher<LarkEvent>,
    private readonly logger: Logger
  ) {
    this.channel = createLarkChannel({
      appId: config.appId,
      appSecret: config.appSecret,
      transport: 'websocket',
      domain: config.domain,
      includeRawEvent: true,
      policy: {
        dmMode: 'open',
        groupAllowlist: [],
        requireMention: false,
        respondToMentionAll: false,
      },
      outbound: {
        retry: {
          maxAttempts: 3,
          baseDelayMs: 500,
        },
      },
      logger,
    });
  }

  async start(): Promise<void> {
    this.channel.on({
      message: async (message) => {
        this.logger.info({message}, "onMessage")
        await this.eventDispatcher.publish({
          source: 'lark',
          type: 'message',
          payload: message,
        })
      },
      cardAction: async (event) => {
        await this.eventDispatcher.publish({
          source: 'lark',
          type: 'cardAction',
          payload: event,
        })
      },
      reconnecting: () => {
        this.connected = false;
        this.logger.warn('Lark long connection reconnecting');
      },
      reconnected: () => {
        this.connected = true;
        this.logger.info('Lark long connection reconnected');
      },
      error: async (error: LarkChannelError) => {
        this.logger.error({ err: error }, 'Lark channel error');
      },
    });

    await this.channel.connect();
    this.connected = true;
  }

  async stop(): Promise<void> {
    this.connected = false;
    await this.channel.disconnect();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendText(chatId: string, text: string, replyTo?: string): Promise<string> {
    const result = await this.channel.send(chatId, { text }, replyTo ? { replyTo } : undefined);
    return result.messageId;
  }

  async sendCard(chatId: string, card: object, replyTo?: string): Promise<string> {
    const result = await this.channel.send(chatId, { card }, replyTo ? { replyTo } : undefined);
    return result.messageId;
  }

  async updateCard(messageId: string, card: object): Promise<void> {
    await this.channel.updateCard(messageId, card);
  }
}
