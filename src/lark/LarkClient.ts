import { WSClient, EventDispatcher as LarkInnerDispatcher, Client } from "@larksuiteoapi/node-sdk";
import {AppConfig} from "../config.js";
import {EventDispatcher, XEvent} from "../event/EventDispatcher.js";
import {Logger} from "pino";

export interface LarkEvent extends XEvent {
  type: 'message' | 'cardAction';
  payload: unknown;
}

export class LarkClient {
  private readonly wsClient: WSClient;
  private readonly httpClient: Client;
  private connected = false;

  constructor(
    config: AppConfig['lark'],
    private readonly eventDispatcher: EventDispatcher<LarkEvent>,
    private readonly logger: Logger
  ) {
    this.wsClient = new WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: config.domain
    });
    this.httpClient = new Client({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: config.domain,
      disableTokenCache: false,
    });
  }

  async start(): Promise<void> {
    const larkInnerDispatcher = new LarkInnerDispatcher({}).register({
      "card.action.trigger": async (data: unknown) => {
        console.log(data);
        return this.eventDispatcher.publish({
          source: 'lark',
          type: 'cardAction',
          payload: data,
        })
      },
      "im.message.receive_v1": async (data) => {
        console.log(data);
        return this.eventDispatcher.publish({
          source: 'lark',
          type: 'message',
          payload: data,
        })
      }
    });
    await this.wsClient.start({eventDispatcher: larkInnerDispatcher})
  }

  async stop(): Promise<void> {
    this.wsClient.close()
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendText(chatId: string, text: string): Promise<string> {
    const res = await this.httpClient.im.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({text: text}),
      },
    })
    return new Promise((resolve) => resolve(res.data?.message_id || ''));
  }

  async sendCard(chatId: string, card: object): Promise<string> {
    console.log(JSON.stringify(card))
    return this.httpClient.im.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      }
    }).then(res => {
      return res.data?.message_id || '';
    });
  }

  async updateCard(messageId: string, card: object): Promise<void> {
    console.log(JSON.stringify({content: JSON.stringify(card)}))
    return this.httpClient.im.message.patch({
      path: {
        message_id: messageId,
      },
      data: {
        content: JSON.stringify(card),
      }
    }).then(res => {
        this.logger.info({result: res}, 'update card')
    });
  }
}