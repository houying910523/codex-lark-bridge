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

async function main() {
  const httpClient = new Client({
    appId: "cli_aaa396c758391bc9",
    appSecret: "uzcLt22maQlGBtwbk1nQAg8zKSRnxYAW",
    domain: "https://fsopen.bytedance.net",
    disableTokenCache: false,
  });
  const res = await httpClient.im.v1.message.patch({
    path: {
      message_id: 'om_x100b6c20bf4f50a8c3c7adb208202d2',
    },
    data: {
      content: '{"config":{"update_multi":true,"width_mode":"default"},"i18n_header":{"zh_cn":{"title":{"tag":"plain_text","content":"选择一个 Codex 会话"},"template":"blue"}},"i18n_elements":{"zh_cn":[{"tag":"markdown","content":"找到 **25** 个会话，按最近活跃时间倒序展示。"},{"tag":"markdown","content":"摘要: **现在需要你对目录: `ida-travel/scripts/flight`, `ida-travel/scripts/t...**\\nRepo: git@code.byted.org:dp/ida-skills.git | Branch: feat/travel-skill | 状态: notLoaded\\n最近活跃: 6/5/2026, 2:50:08 PM\\nworkspace: /Users/bytedance/git/bytedance/ida-skills/ida-travel"},{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"继续"},"value":{"action":"open_continue","sessionId":"019e9661-e7ee-7dd3-bbdf-3fbac434d6bb"},"type":"primary","disabled":false},{"tag":"button","text":{"tag":"plain_text","content":"详情"},"value":{"action":"view_session_detail","sessionId":"019e9661-e7ee-7dd3-bbdf-3fbac434d6bb"},"disabled":false}]},{"tag":"hr"},{"tag":"markdown","content":"摘要: **分析目 标目录：`apps/travel-hotel-mini/src` 下，关于所有预定火车票流程的文件，分析文件之间的...**\\nRepo: git@code.byted.org:ea/travel-fe-mono.git | Branch: release_train__1160057370370 | 状态: notLoaded\\n最近活跃: 6/3/2026, 3:02:19 PM\\nworkspace: /Users/bytedance/git/bytedance/travel-fe-mono"},{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"继续"},"value":{"action":"open_continue","sessionId":"019e8b77-3b77-7a93-974e-f69f5f077145"},"type":"primary","disabled":false},{"tag":"button","text":{"tag":"plain_text","content":"详情"},"value":{"action":"view_session_detail","sessionId":"019e8b77-3b77-7a93-974e-f69f5f077145"},"disabled":false}]},{"tag":"hr"},{"tag":"markdown","content":"摘要: **分析目标目录：`apps/travel-hotel-mini/src`下的代码，找出所有和机票预定相关的代码文件，及文件...**\\nRepo: git@code.byted.org:ea/travel-fe-mono.git | Branch: release_train__1160057370370 | 状态: notLoaded\\n最近活跃: 6/3/2026, 5:54:07 PM\\nworkspace: /Users/bytedance/git/bytedance/travel-fe-mono"},{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"继续"},"value":{"action":"open_continue","sessionId":"019e8b74-30b3-72d0-927f-a3c4bf770789"},"type":"primary","disabled":false},{"tag":"button","text":{"tag":"plain_text","content":"详情"},"value":{"action":"view_session_detail","sessionId":"019e8b74-30b3-72d0-927f-a3c4bf770789"},"disabled":false}]},{"tag":"hr"},{"tag":"markdown","content":"摘要: **你需要根据 `ida-travel/scripts/travel_hotel_skill.py`脚本的用法，完成skil...**\\nRepo: git@code.byted.org:dp/ida-skills.git | Branch: feat/travel-skill | 状态: notLoaded\\n最近活跃: 6/2/2026, 8:04:36 PM\\nworkspace: /Users/bytedance/git/bytedance/ida-skills/ida-travel"},{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"继续"},"value":{"action":"open_continue","sessionId":"019e8835-86a7-7ce2-ae3b-6e123d82d3f6"},"type":"primary","disabled":false},{"tag":"button","text":{"tag":"plain_text","content":"详情"},"value":{"action":"view_session_detail","sessionId":"019e8835-86a7-7ce2-ae3b-6e123d82d3f6"},"disabled":false}]},{"tag":"hr"},{"tag":"markdown","content":"摘要: **这里有一个在chrome上抓包的文件：`/Users/bytedance/Downloads/travel.byteda...**\\nRepo: git@code.byted.org:dp/ida-skills.git | Branch: feat/travel-skill | 状态: notLoaded\\n最近活跃: 6/2/2026, 7:38:04 PM\\nworkspace: /Users/bytedance/git/bytedance/ida-skills/ida-approval"},{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"继续"},"value":{"action":"open_continue","sessionId":"019e8344-7bf2-72e2-b42c-44f597d94874"},"type":"primary","disabled":false},{"tag":"button","text":{"tag":"plain_text","content":"详情"},"value":{"action":"view_session_detail","sessionId":"019e8344-7bf2-72e2-b42c-44f597d94874"},"disabled":false}]},{"tag":"hr"},{"tag":"markdown","content":"摘要: **更改脚本`scripts/approval_skill.py`，现有的list子命令能够拉取所有待审批的申请列表，现在需...**\\nRepo: git@code.byted.org:dp/ida-skills.git | Branch: feat/refactor-approval | 状态: notLoaded\\n最近活跃: 6/1/2026, 12:12:00 AM\\nworkspace: /Users/bytedance/git/bytedance/ida-skills/ida-approval"},{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"继续"},"value":{"action":"open_continue","sessionId":"019e7e97-1cb9-7803-b031-8b42d93ace79"},"type":"primary","disabled":false},{"tag":"button","text":{"tag":"plain_text","content":"详情"},"value":{"action":"view_session_detail","sessionId":"019e7e97-1cb9-7803-b031-8b42d93ace79"},"disabled":false}]},{"tag":"hr"},{"tag":"markdown","content":"摘要: **当前目录是一个审批skill，你需要先分析有关于审批能力的所有流程，涉及的脚本主要包括`references/appro...**\\nRepo: git@code.byted.org:dp/ida-skills.git | Branch: feat-approval-skill | 状态: notLoaded\\n最近活跃: 5/31/2026, 10:50:22 PM\\nworkspace: /Users/bytedance/git/bytedance/ida-skills/ida-approval"},{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"继续"},"value":{"action":"open_continue","sessionId":"019e7dcd-9614-7a43-aee2-3186ee3b8b29"},"type":"primary","disabled":false},{"tag":"button","text":{"tag":"plain_text","content":"详情"},"value":{"action":"view_session_detail","sessionId":"019e7dcd-9614-7a43-aee2-3186ee3b8b29"},"disabled":false}]},{"tag":"hr"},{"tag":"markdown","content":"摘要: ** 分析从chrome抓取的网络请求包：/Users/bytedance/Downloads/travel.bytedanc...**\\nRepo: git@code.byted.org:dp/ida-skills.git | Branch: feat/travel-skill | 状态: notLoaded\\n最近活跃: 5/28/2026, 9:04:52 PM\\nworkspace: /Users/bytedance/git/bytedance/ida-skills/ida-travel"},{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"继续"},"value":{"action":"open_continue","sessionId":"019e6e77-fce8-70a1-9e76-4e63ee6f24e6"},"type":"primary","disabled":false},{"tag":"button","text":{"tag":"plain_text","content":"详情"},"value":{"action":"view_session_detail","sessionId":"019e6e77-fce8-70a1-9e76-4e63ee6f24e6"},"disabled":false}]},{"tag":"hr"},{"tag":"markdown","content":"摘要: **分析从chrome上抓取下来的`/Users/bytedance/Downloads/travel.bytedance....**\\nRepo: git@code.byted.org:dp/ida-skills.git | Branch: feat/travel-skill | 状态: notLoaded\\n最近活跃: 5/28/2026, 7:28:14 PM\\nworkspace: /Users/bytedance/git/bytedance/ida-skills/ida-travel"},{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"继续"},"value":{"action":"open_continue","sessionId":"019e6d19-8487-7043-9a77-4cc41d0a079a"},"type":"primary","disabled":false},{"tag":"button","text":{"tag":"plain_text","content":"详情"},"value":{"action":"view_session_detail","sessionId":"019e6d19-8487-7043-9a77-4cc41d0a079a"},"disabled":false}]},{"tag":"hr"},{"tag":"markdown","content":"摘要: **`/Users/bytedance/Downloads/travel.bytedance.com.har` 这个文件是抓...**\\nRepo: git@code.byted.org:dp/ida-skills.git | Branch: feat-approval-skill | 状态: notLoaded\\n最近活跃: 5/28/2026, 12:03:59 AM\\nworkspace: /Users/bytedance/git/bytedance/ida-skills/ida-travel"},{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"继续"},"value":{"action":"open_continue","sessionId":"019e6870-1c38-79c3-8ed7-2897a0d6c03a"},"type":"primary","disabled":false},{"tag":"button","text":{"tag":"plain_text","content":"详情"},"value":{"action":"view_session_detail","sessionId":"019e6870-1c38-79c3-8ed7-2897a0d6c03a"},"disabled":false}]},{"tag":"hr"},{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"上一页"},"value":{"action":"page_sessions","page":0},"disabled":false},{"tag":"button","text":{"tag":"plain_text","content":"下一页"},"value":{"action":"page_sessions","page":2},"disabled":false},{"tag":"button","text":{"tag":"plain_text","content":"刷新"},"value":{"action":"refresh_sessions","page":1},"disabled":false}]}]}}'
    }
  })
  console.log(res)
}

await main()