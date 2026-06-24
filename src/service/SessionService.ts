import {CodexController} from "../codex/CodexController";
import {Logger} from "pino";
import LarkClient, {LarkEvent} from "../lark/LarkClient";
import {ParsedCommand} from "../domain/commands";
import {buildSessionDetailCard, buildSessionsCard} from "../lark/LarkCard";
import {SessionSummary} from "../domain/models";
import {TaskStore} from "../storage/TaskStore";
import {EventDispatcher} from "../event/EventDispatcher";
import {CodexEvent} from "../codex/CodexGateway";

const PAGE_SIZE = 10

export class SessionService {
  constructor(
    private readonly codexController: CodexController,
    codexEventDispatcher: EventDispatcher<CodexEvent>,
    private readonly lark: LarkClient,
    larkEventDispatcher: EventDispatcher<LarkEvent>,
    private readonly taskStore: TaskStore,
    private readonly logger: Logger,
  ) {
    codexEventDispatcher.registerHandler('codex-gateway', event => this.onCodexEvent(event))
    larkEventDispatcher.registerHandler('lark', event => this.onLarkEvent(event))
  }

  async onCodexEvent(event: CodexEvent): Promise<void> {
    if (event.method === 'initialized') {
      await this.restoreSession()
    }
  }

  async restoreSession(): Promise<void> {
    const taskState = await this.taskStore.read()
    if (!taskState.currentSessionId || !taskState.session || !taskState.lark) {
      return
    }
    this.logger.info("restore session: " + taskState.currentSessionId)
    await this.selectSession(taskState.lark.chatId, taskState.currentSessionId)
  }

  async onLarkEvent(event: LarkEvent): Promise<void> {
    this.logger.info(event)
    const messageType = event.type

    if (messageType === 'message') {
       await this.onLarkMessage(event.payload.data, event.payload.command)
    }
    if (messageType === 'cardAction') {
      await this.onLarkCardAction(event.payload.data)
    }
  }

  async onLarkMessage(data: Record<string, any>, command?: ParsedCommand): Promise<void> {
    this.logger.info({data, command})
    const {
      chat_id: chatId,
      message_id: messageId,
    } = data.message

    switch (command?.kind) {
      case 'sessions':
        await this.listSessions(chatId, 0, messageId, false);
        break;
      case 'new':
        await this.createNewSession(chatId, messageId)
        break;
      case 'user_message': {
        const taskState = await this.taskStore.read()
        if (!taskState.currentSessionId) {
          await this.lark.sendText(chatId, helpText());
        }
        break;
      }
      default:
        break;
    }
  }

  async onLarkCardAction(payload: Record<string, any>): Promise<void> {
    const actionValue = payload.action.value as Record<string, unknown>
    const {
      open_message_id: messageId,
      open_chat_id: chatId,
    } = payload.context
    if (actionValue.action === 'page_sessions' || actionValue.action === 'refresh_sessions') {
      const page = actionValue.page as number
      await this.listSessions(chatId, page ?? 0, messageId, true)
    }
    if (actionValue.action === 'view_session_detail') {
      const sessionId = actionValue.sessionId as string
      await this.getSession(chatId, sessionId, payload.operator?.user_id)
    }
    if (actionValue.action === 'continue_session') {
      const sessionId = actionValue.sessionId as string
      await this.selectSession(chatId, sessionId)
    }
  }

  async createNewSession(chatId: string, messageId: string): Promise<void> {
    const session = await this.codexController.createSession()
    if (session) {
      await this.lark.sendText(chatId, '会话已创建：' + session.id);
      await this.taskStore.write({
        currentSessionId: session.id,
        lark: {
          chatId: chatId,
          messageId: messageId,
        },
        session: session
      })
    } else {
      await this.lark.sendText(chatId, '会话创建失败');
    }
  }

  async selectSession(chatId: string, sessionId: string): Promise<void> {
    const session = await this.codexController.resumeSession(sessionId)
    if (session) {
      await this.lark.sendText(chatId, '会话已恢复：' + session.id);
      await this.taskStore.write({
        currentSessionId: session.id,
        session: session,
        lark: {
          chatId: chatId,
          messageId: ''
        }
      })
    } else {
      await this.lark.sendText(chatId, '会话不存在');
    }
  }

  async getSession(chatId: string, sessionId: string, userId: string): Promise<void> {
    const session = await this.codexController.getSession(sessionId)
    if (!session) {
      await this.lark.sendText(chatId, '会话不存在');
      return;
    }
    const card = buildSessionDetailCard(session, userId)
    await this.lark.sendCard(chatId, card)
  }

  async listSessions(chatId: string, page: number, messageId: string, update: boolean): Promise<void> {
    const sessions = await this.codexController.listSessions();
    const sessionSummaries: SessionSummary[] = sessions.map(session => ({
      sessionId: session.id,
      title: session.preview.substring(0, Math.min(60, session.preview.length)) + '...',
      workspace: session.cwd,
      repo: session.gitInfo?.originUrl,
      branch: session.gitInfo?.branch,
      lastActiveAt: new Date(session.updatedAt * 1000).toLocaleString(),
      status: session.status.type,
    }))
    const card = buildSessionsCard(
      sessionSummaries,
      page,
      PAGE_SIZE,
    )
    if (update) {
      this.logger.info({messageId}, "update card")
      await this.lark.updateCard(messageId, card);
    } else {
      this.logger.info({chatId}, "send card")
      await this.lark.sendCard(chatId, card);
    }
  }
}

function helpText(): string {
  return [
    '可用命令：',
    '/codex sessions',
    '/codex new <指令>',
    '/codex status',
  ].join('\n');
}
