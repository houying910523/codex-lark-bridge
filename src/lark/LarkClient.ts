import { WSClient, EventDispatcher as LarkInnerDispatcher, Client } from "@larksuiteoapi/node-sdk";
import {AppConfig} from "../config.js";
import {EventDispatcher, XEvent} from "../event/EventDispatcher.js";
import {Logger} from "pino";
import {parseCommand, ParsedCommand} from "../domain/commands";

export interface LarkEvent extends XEvent {
  type: 'message' | 'cardAction';
  payload: {
    data: Record<string, any>,
    command?: ParsedCommand
  };
}

type PostMessage = {
  title: string,
  content: [
    [
      {
        tag: string,
        text: string,
      }
    ]
  ]
}
type MessageHandler = (content: any) => string

class LarkClient {
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
        return this.eventDispatcher.publish({
          source: 'lark',
          type: 'cardAction',
          payload: {
            data: data as Record<string, any>
          },
        })
      },
      "im.message.receive_v1": async (data) => {
        this.logger.info({data})
        const {
          chat_id: chatId,
          chat_type: chatType,
          content,
          message_type: messageType,
        } = data.message
        if (chatType !== 'p2p') {
          await this.sendText(chatId, '当前仅支持飞书机器人私聊使用。');
          return;
        }
        const text = this.getMessageByType(messageType)(JSON.parse(content))
        const command = parseCommand(text)
        this.logger.info(command, "parse command")
        return this.eventDispatcher.publish({
          source: 'lark',
          type: 'message',
          payload: {
            data: data,
            command
          },
        })
      }
    });
    await this.wsClient.start({eventDispatcher: larkInnerDispatcher})
  }

  getMessageByType(messageType: string): MessageHandler {
    if (messageType === 'text') {
      return (content) => content.text as string
    }
    if (messageType === 'post') {
      return (content: PostMessage) => {
        return content.content.map(line => {
          return line.map(item => {
            console.log(item.text)
            return item.text
          }).join(' ')
        }).join('\n')
      }
    }
    throw new Error("unrecognised message type: " + messageType)
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
    return res.data?.message_id || '';
  }

  async sendCard(chatId: string, card: object): Promise<string> {
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

export default LarkClient