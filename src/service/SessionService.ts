import {CodexController} from "../codex/CodexController.js";
import {Logger} from "pino";
import {EventDispatcher} from "../event/EventDispatcher.js";
import {LarkClient, LarkEvent} from "../lark/LarkClient.js";
import {CodexEvent} from "../codex/CodexGateway.js";
import {CardActionEvent, NormalizedMessage} from "@larksuiteoapi/node-sdk";
import {parseCommand} from "../domain/commands.js";
import {buildSessionsCard} from "../lark/LarkCard.js";
import {SessionSummary} from "../domain/models.js";

const PAGE_SIZE = 10

export class SessionService {
  constructor(
    private readonly codexController: CodexController,
    private readonly codexEventDispatcher: EventDispatcher<CodexEvent>,
    private readonly lark: LarkClient,
    private readonly larkEventDispatcher: EventDispatcher<LarkEvent>,
    private readonly logger: Logger,
  ) {
    larkEventDispatcher.registerHandler('lark', event => this.onLarkEvent(event))
    codexEventDispatcher.registerHandler('codex-gateway', event => this.onCodexEvent(event))
  }

  async onLarkEvent(event: LarkEvent): Promise<void> {
    this.logger.info(event)
    const messageType = event.type
    this.logger.info("lark event: " + messageType)

    if (messageType === 'message') {
       await this.onLarkMessage(event.payload as NormalizedMessage)
    }
    if (messageType === 'cardAction') {
      await this.onLarkCardAction(event.payload as CardActionEvent)
    }
  }

  async onLarkMessage(payload: Record<string, any>): Promise<void> {
    this.logger.info({payload})
    const {
      chat_id: chatId,
      chat_type: chatType,
      content: content,
      message_id: messageId,
    } = payload.message
    if (chatType !== 'p2p') {
      await this.lark.sendText(chatId, '当前仅支持飞书机器人私聊使用。');
      return;
    }
    const text = JSON.parse(content).text
    this.logger.info("parse command: " + text)
    const command = parseCommand(text)
    if (!command) {
      await this.lark.sendText(chatId, helpText());
      return;
    }
    switch (command.kind) {
      case 'sessions':
        await this.listSessions(chatId, 0, messageId, false)
    }
  }

  async onLarkCardAction(payload: Record<string, any>): Promise<void> {
    console.log(payload)
    const actionValue = payload.action.value as Record<string, unknown>
    if (actionValue.action === 'page_sessions') {
      const page = actionValue.page as number
      const {
        open_message_id: messageId,
        open_chat_id: chatId,
      } = payload.context
      await this.listSessions(chatId, page ?? 0, messageId, true)
    }
  }

  async onCodexEvent(event: CodexEvent): Promise<void> {
    this.logger.info(event)
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
    '/codex continue',
    '/codex continue <你的指令>',
    '/codex status',
    '/codex stop',
  ].join('\n');
}
