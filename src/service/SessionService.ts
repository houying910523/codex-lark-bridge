import {CodexController} from "../codex/CodexController.js";
import {Logger} from "pino";
import {EventDispatcher} from "../event/EventDispatcher.js";
import {LarkClient, LarkEvent} from "../lark/LarkClient.js";
import {CodexEvent} from "../codex/CodexGateway.js";
import {NormalizedMessage} from "@larksuiteoapi/node-sdk";
import {parseCommand} from "../domain/commands.js";
import {buildSessionsCard} from "../lark/LarkCard.js";
import {SessionSummary} from "../domain/models.js";

export class SessionService {
  constructor(
    private readonly codexController: CodexController,
    private readonly codexEventDispatcher: EventDispatcher<CodexEvent>,
    private readonly lark: LarkClient,
    private readonly larkEventDispatcher: EventDispatcher<LarkEvent>,
    private readonly logger: Logger,
  ) {
    larkEventDispatcher.registerHandler('lark', this.onLarkEvent)
    codexEventDispatcher.registerHandler('codex-gateway', this.onCodexEvent)
  }

  async onLarkEvent(event: LarkEvent): Promise<void> {
    this.logger.info(event)
    const messageType = event.type
    this.logger.info("lark event: " + messageType)

    if (messageType === 'message') {
       return this.onLarkMessage(event.payload as NormalizedMessage)
    }
  }

  async onLarkMessage(payload: NormalizedMessage): Promise<void> {
    this.logger.info(payload)
    const chatType = payload.chatType;
    if (chatType !== 'p2p') {
      await this.lark.sendText(payload.chatId, '当前仅支持飞书机器人私聊使用。', payload.messageId);
      return;
    }
    this.logger.info("parse command: " + payload.content)
    const command = parseCommand(payload.content)
    if (!command) {
      await this.lark.sendText(payload.chatId, helpText(), payload.messageId);
      return;
    }
    switch (command.kind) {
      case 'sessions':
        await this.listSessions(payload.chatId, payload.senderId, 0, payload.messageId)
    }
  }

  async onCodexEvent(event: CodexEvent): Promise<void> {
    this.logger.info(event)
  }

  async listSessions(chatId: string, operatorId: string, page: number, replyTo?: string, messageId?: string): Promise<void> {
    this.logger.info("list sessions")
    const sessions = await this.codexController.listSessions();
    const sessionSummaries: SessionSummary[] = sessions.map(session => ({
      sessionId: session.id,
      title: session.preview,
      workspace: session.cwd,
      lastActiveAt: new Date(session.updatedAt * 1000).toLocaleString(),
      status: session.status.type,
    }))
    const card = buildSessionsCard(
      sessionSummaries,
      page,
      10,
    )
    if (messageId) {
      await this.lark.updateCard(messageId, card);
    } else {
      await this.lark.sendCard(chatId, card, replyTo);
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