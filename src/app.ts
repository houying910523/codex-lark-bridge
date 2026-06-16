import type { CardActionEvent, NormalizedMessage } from '@larksuiteoapi/node-sdk';
import type { Logger } from 'pino';

import type { AppConfig } from './config.js';
import { buildConfirmationCard, buildContinueCard, buildRunningCard, buildSessionDetailCard, buildSessionsCard, buildStatusCard, buildTerminalCard } from './lark/LarkCard.js';
import type { LarkClient } from './lark/LarkClient.js';
import { parseCommand } from './domain/commands.js';
import { DEFAULT_CONTINUE_OPTIONS, digestPrompt, isTerminalState, truncate, type BridgeEvent, type ContinueOptions, type PendingDecision, type SessionDetail, type SessionSummary, type TaskRecord } from './domain/models.js';
import { applyTaskSnapshot, createInitialTaskRecord, reduceTaskEvent } from './domain/state.js';
import type { CodexWebSocketClient } from './codex.js';
import { AuditRepository, BindingsRepository, DecisionsRepository, TasksRepository } from './storage/repositories.js';

const PAGE_SIZE = 5;

export class BridgeApplication {
  private readonly sessionCache = new Map<string, SessionSummary | SessionDetail>();
  private readonly throttledUpdates = new Map<string, NodeJS.Timeout>();
  private readonly subscriptions = new Map<string, () => void>();
  private started = false;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly lark: LarkClient,
    private readonly codex: CodexWebSocketClient,
    private readonly bindings: BindingsRepository,
    private readonly tasks: TasksRepository,
    private readonly decisions: DecisionsRepository,
    private readonly audit: AuditRepository,
  ) {}

  async start(): Promise<void> {
    await this.codex.connect();
    await this.restoreActiveTasks();
    await this.lark.start();
    this.started = true;
  }

  async stop(): Promise<void> {
    for (const timer of this.throttledUpdates.values()) {
      clearTimeout(timer);
    }
    this.throttledUpdates.clear();

    for (const unsubscribe of this.subscriptions.values()) {
      unsubscribe();
    }
    this.subscriptions.clear();

    await Promise.all([this.lark.stop(), this.codex.disconnect()]);
    this.started = false;
  }

  getReadiness(): {
    started: boolean;
    larkConnected: boolean;
    codexConnected: boolean;
  } {
    return {
      started: this.started,
      larkConnected: this.lark.isConnected(),
      codexConnected: this.codex.isConnected(),
    };
  }

  private async onMessage(message: NormalizedMessage): Promise<void> {
    if (message.chatType !== 'p2p') {
      await this.lark.sendText(message.chatId, '当前仅支持飞书机器人私聊使用。', message.messageId);
      return;
    }

    const command = parseCommand(message.content);
    if (!command) {
      await this.lark.sendText(message.chatId, helpText(), message.messageId);
      return;
    }

    const operatorId = message.senderId;
    try {
      switch (command.kind) {
        case 'sessions':
          await this.showSessions(message.chatId, operatorId, 0, message.messageId);
          break;
        case 'status':
          await this.showStatus(message.chatId, operatorId, message.messageId);
          break;
        case 'stop':
          await this.stopActiveTask(message.chatId, operatorId, message.messageId);
          break;
        case 'new':
          await this.lark.sendText(
            message.chatId,
            'MVP 暂不支持 /codex new。请先通过 /codex sessions 选择已有会话。',
            message.messageId,
          );
          break;
        case 'continue':
          if (command.prompt) {
            const selectedSessionId = await this.resolveSelectedSession(operatorId);
            if (!selectedSessionId) {
              await this.lark.sendText(message.chatId, '请先执行 /codex sessions 选择一个会话。', message.messageId);
              return;
            }

            await this.startTask({
              chatId: message.chatId,
              operatorId,
              sessionId: selectedSessionId,
              prompt: command.prompt,
              options: command.options,
              replyTo: message.messageId,
            });
          } else {
            const selectedSessionId = await this.resolveSelectedSession(operatorId);
            if (!selectedSessionId) {
              await this.lark.sendText(message.chatId, '请先执行 /codex sessions 选择一个会话。', message.messageId);
              return;
            }

            await this.openContinueCard(message.chatId, operatorId, selectedSessionId, undefined, message.messageId);
          }
          break;
      }
    } catch (error) {
      await this.handleFailure({
        chatId: message.chatId,
        operatorId,
        action: 'message_command',
        error,
        replyTo: message.messageId,
      });
    }
  }

  private async onCardAction(event: CardActionEvent): Promise<void> {
    const operatorId = event.operator.openId;
    const action = this.coerceAction(event.action.value);
    if (!action) {
      await this.lark.sendText(event.chatId, '未识别的卡片动作。请改用文本命令重试。', event.messageId);
      return;
    }

    try {
      switch (action.action) {
        case 'refresh_sessions':
        case 'page_sessions':
          await this.showSessions(event.chatId, operatorId, action.page ?? 0, undefined, event.messageId);
          break;
        case 'view_session_detail':
          await this.showSessionDetail(event.chatId, operatorId, action.sessionId, event.messageId);
          break;
        case 'open_continue':
          await this.openContinueCard(event.chatId, operatorId, action.sessionId, event.messageId);
          break;
        case 'submit_continue': {
          const prompt = extractPromptFromCard(event);
          if (!prompt) {
            await this.lark.sendText(
              event.chatId,
              '没有读取到卡片里的指令内容。请直接发送 `/codex continue <你的指令>`。',
              event.messageId,
            );
            return;
          }

          await this.startTask({
            chatId: event.chatId,
            operatorId,
            sessionId: action.sessionId,
            prompt,
            options: parseContinueOptions(action.options),
            existingMessageId: event.messageId,
          });
          break;
        }
        case 'refresh_task':
          await this.refreshTask(action.taskId, true);
          break;
        case 'stop_task':
          await this.stopTaskById(action.taskId, operatorId, event.chatId, event.messageId);
          break;
        case 'submit_decision':
          await this.submitDecision(action.taskId, action.decisionToken, action.option, operatorId);
          break;
      }
    } catch (error) {
      await this.handleFailure({
        chatId: event.chatId,
        operatorId,
        action: 'card_action',
        error,
        replyTo: event.messageId,
      });
    }
  }

  private async showSessions(
    chatId: string,
    operatorId: string,
    page: number,
    replyTo?: string,
    existingMessageId?: string,
  ): Promise<void> {
    const sessions = await this.codex.listSessions(operatorId);
    sessions.forEach((session) => this.sessionCache.set(session.sessionId, session));

    const card = buildSessionsCard(
      sessions,
      page,
      PAGE_SIZE,
    );

    const messageId = await this.renderCard(chatId, card, existingMessageId, replyTo);
    await this.bindings.bindMessage({
      messageId,
      chatId,
      cardType: 'sessions',
      updatedAt: Date.now(),
    });
    await this.audit.append({
      timestamp: Date.now(),
      operatorId,
      action: 'show_sessions',
      result: 'success',
      details: { count: sessions.length, page },
    });
  }

  private async showSessionDetail(
    chatId: string,
    operatorId: string,
    sessionId: string,
    existingMessageId?: string,
  ): Promise<void> {
    const detail = await this.codex.getSessionDetail(sessionId, operatorId);
    this.sessionCache.set(sessionId, detail);

    await this.bindings.updateUser(operatorId, (current) => ({
      larkUserId: operatorId,
      chatId,
      lastSelectedSessionId: sessionId,
      activeTaskId: current?.activeTaskId,
      updatedAt: Date.now(),
    }));

    const messageId = await this.renderCard(chatId, buildSessionDetailCard(detail), existingMessageId);
    await this.bindings.bindMessage({
      messageId,
      chatId,
      cardType: 'detail',
      sessionId,
      updatedAt: Date.now(),
    });
  }

  private async openContinueCard(
    chatId: string,
    operatorId: string,
    sessionId: string,
    existingMessageId?: string,
    replyTo?: string,
  ): Promise<void> {
    const session = await this.getSessionSummary(sessionId, operatorId);
    await this.bindings.updateUser(operatorId, (current) => ({
      larkUserId: operatorId,
      chatId,
      lastSelectedSessionId: sessionId,
      activeTaskId: current?.activeTaskId,
      updatedAt: Date.now(),
    }));

    const messageId = await this.renderCard(chatId, buildContinueCard(session), existingMessageId, replyTo);
    await this.bindings.bindMessage({
      messageId,
      chatId,
      cardType: 'input',
      sessionId,
      updatedAt: Date.now(),
    });
  }

  private async startTask(input: {
    chatId: string;
    operatorId: string;
    sessionId: string;
    prompt: string;
    options: ContinueOptions;
    replyTo?: string;
    existingMessageId?: string;
  }): Promise<void> {
    const activeTask = await this.findActiveTaskForUser(input.operatorId);
    if (activeTask) {
      await this.lark.sendText(
        input.chatId,
        `当前已有运行中的任务 \`${activeTask.taskId}\`。请先等待完成或执行 /codex stop。`,
        input.replyTo,
      );
      return;
    }

    const session = await this.getSessionSummary(input.sessionId, input.operatorId);
    const idempotencyKey = `${input.operatorId}:${input.chatId}:continue:${input.sessionId}:${digestPrompt(input.prompt)}`;
    const existing = await this.bindings.getIdempotency(idempotencyKey);
    if (existing?.taskId) {
      const task = await this.tasks.get(existing.taskId);
      if (task) {
        await this.lark.sendText(input.chatId, `重复提交已忽略，当前任务为 \`${task.taskId}\`。`, input.replyTo);
        return;
      }
    }

    const { taskId } = await this.codex.continueSession(
      input.sessionId,
      input.prompt,
      input.options,
      input.operatorId,
    );

    const task = createInitialTaskRecord({
      taskId,
      sessionId: input.sessionId,
      sessionTitle: session.title,
      // repo: session.repo,
      // branch: session.branch,
      operatorId: input.operatorId,
      chatId: input.chatId,
      messageId: input.existingMessageId,
      promptDigest: digestPrompt(input.prompt),
    });

    await this.tasks.put(task);
    await this.bindings.rememberIdempotency({
      key: idempotencyKey,
      action: 'continue',
      taskId,
      createdAt: Date.now(),
    });
    await this.bindings.updateUser(input.operatorId, () => ({
      larkUserId: input.operatorId,
      chatId: input.chatId,
      lastSelectedSessionId: input.sessionId,
      activeTaskId: taskId,
      updatedAt: Date.now(),
    }));

    const messageId = await this.renderCard(input.chatId, buildRunningCard(task), input.existingMessageId, input.replyTo);
    const persisted = { ...task, messageId };
    await this.tasks.put(persisted);
    await this.bindings.bindMessage({
      messageId,
      chatId: input.chatId,
      cardType: 'running',
      sessionId: input.sessionId,
      taskId,
      updatedAt: Date.now(),
    });

    await this.subscribeTask(taskId);
    await this.audit.append({
      timestamp: Date.now(),
      operatorId: input.operatorId,
      action: 'start_task',
      targetId: taskId,
      result: 'success',
      details: {
        sessionId: input.sessionId,
        options: input.options,
      },
    });
  }

  private async showStatus(chatId: string, operatorId: string, replyTo?: string): Promise<void> {
    const task = await this.findLatestTaskForUser(operatorId);
    if (!task) {
      await this.lark.sendText(chatId, '当前没有最近任务。请先执行 /codex sessions。', replyTo);
      return;
    }

    const decision = await this.decisions.get(task.taskId);
    const card = decision ? buildConfirmationCard(task, decision) : buildStatusCard(task);
    await this.lark.sendCard(chatId, card, replyTo);
  }

  private async stopActiveTask(chatId: string, operatorId: string, replyTo?: string): Promise<void> {
    const task = await this.findActiveTaskForUser(operatorId);
    if (!task) {
      await this.lark.sendText(chatId, '当前没有运行中的任务。', replyTo);
      return;
    }

    await this.stopTaskById(task.taskId, operatorId, chatId, replyTo);
  }

  private async stopTaskById(taskId: string, operatorId: string, chatId: string, replyTo?: string): Promise<void> {
    const task = await this.tasks.get(taskId);
    if (!task) {
      await this.lark.sendText(chatId, `找不到任务 \`${taskId}\`。`, replyTo);
      return;
    }

    await this.codex.cancelTask(taskId, operatorId);
    const updated: TaskRecord = {
      ...task,
      state: 'Cancelling',
      phase: 'Stopping',
      updatedAt: Date.now(),
    };
    await this.tasks.put(updated);
    await this.refreshRenderedTask(updated);
  }

  private async submitDecision(
    taskId: string,
    decisionToken: string,
    option: string,
    operatorId: string,
  ): Promise<void> {
    await this.codex.submitDecision(taskId, decisionToken, option, operatorId);
    await this.decisions.remove(taskId);
    const task = await this.tasks.get(taskId);
    if (!task) {
      return;
    }

    const updated: TaskRecord = {
      ...task,
      state: 'Running',
      viewState: 'RunningView',
      phase: `Decision submitted: ${option}`,
      updatedAt: Date.now(),
    };
    await this.tasks.put(updated);
    await this.refreshRenderedTask(updated);
  }

  private async restoreActiveTasks(): Promise<void> {
    const activeTasks = await this.tasks.listActive();
    for (const task of activeTasks) {
      await this.subscribeTask(task.taskId);
      await this.refreshTask(task.taskId, false);
    }
  }

  private async subscribeTask(taskId: string): Promise<void> {
    if (this.subscriptions.has(taskId)) {
      return;
    }

    const unsubscribe = await this.codex.subscribeTaskEvents(taskId, async (event) => {
      await this.handleTaskEvent(event);
    });
    this.subscriptions.set(taskId, unsubscribe);
  }

  private async handleTaskEvent(event: BridgeEvent): Promise<void> {
    const current = await this.tasks.get(event.taskId ?? '');
    if (!current || event.sequence < current.lastSequence) {
      return;
    }

    const { task, decision } = reduceTaskEvent(current, event);
    await this.tasks.put(task);
    if (decision) {
      await this.decisions.put(decision);
    } else if (task.state !== 'WaitingDecision') {
      await this.decisions.remove(task.taskId);
    }

    if (event.eventType === 'task_output_appended') {
      this.scheduleTaskRefresh(task.taskId);
      return;
    }

    await this.refreshRenderedTask(task, decision);
  }

  private scheduleTaskRefresh(taskId: string): void {
    if (this.throttledUpdates.has(taskId)) {
      return;
    }

    const timer = setTimeout(async () => {
      this.throttledUpdates.delete(taskId);
      const task = await this.tasks.get(taskId);
      if (task) {
        const decision = await this.decisions.get(taskId);
        await this.refreshRenderedTask(task, decision);
      }
    }, this.config.outputThrottleMs);

    this.throttledUpdates.set(taskId, timer);
  }

  private async refreshTask(taskId: string, notifyOnFailure: boolean): Promise<void> {
    const current = await this.tasks.get(taskId);
    if (!current) {
      return;
    }

    try {
      const snapshot = await this.codex.getTaskSnapshot(taskId);
      const updated = applyTaskSnapshot(current, snapshot);
      await this.tasks.put(updated);
      const decision = await this.decisions.get(taskId);
      await this.refreshRenderedTask(updated, decision);
    } catch (error) {
      if (notifyOnFailure) {
        await this.handleFailure({
          chatId: current.chatId,
          operatorId: current.operatorId,
          action: 'refresh_task',
          error,
          replyTo: current.messageId,
        });
      }
    }
  }

  private async refreshRenderedTask(task: TaskRecord, decision?: PendingDecision): Promise<void> {
    let card: object;
    if (task.viewState === 'ConfirmationView') {
      const pending = decision ?? (await this.decisions.get(task.taskId));
      if (pending) {
        card = buildConfirmationCard(task, pending);
      } else {
        card = buildRunningCard(task);
      }
    } else if (isTerminalState(task.state)) {
      card = buildTerminalCard(task);
    } else {
      card = buildRunningCard(task);
    }

    if (task.messageId) {
      try {
        await this.lark.updateCard(task.messageId, card);
      } catch (error) {
        await this.audit.append({
          timestamp: Date.now(),
          operatorId: task.operatorId,
          action: 'delivery_failed',
          targetId: task.taskId,
          result: 'failure',
          details: { message: String(error) },
        });
        await this.lark.sendText(task.chatId, `任务 ${task.taskId} 状态更新：${task.state}`, task.messageId);
      }
    } else {
      const messageId = await this.lark.sendCard(task.chatId, card);
      await this.tasks.put({ ...task, messageId });
    }

    if (isTerminalState(task.state)) {
      await this.bindings.updateUser(task.operatorId, (current) => ({
        larkUserId: task.operatorId,
        chatId: task.chatId,
        lastSelectedSessionId: current?.lastSelectedSessionId ?? task.sessionId,
        activeTaskId: undefined,
        updatedAt: Date.now(),
      }));

      const unsubscribe = this.subscriptions.get(task.taskId);
      if (unsubscribe) {
        unsubscribe();
        this.subscriptions.delete(task.taskId);
      }
      await this.decisions.remove(task.taskId);
    }
  }

  private async renderCard(
    chatId: string,
    card: object,
    existingMessageId?: string,
    replyTo?: string,
  ): Promise<string> {
    if (existingMessageId) {
      await this.lark.updateCard(existingMessageId, card);
      return existingMessageId;
    }

    return this.lark.sendCard(chatId, card, replyTo);
  }

  private async getSessionSummary(sessionId: string, operatorId: string): Promise<SessionSummary> {
    const cached = this.sessionCache.get(sessionId);
    if (cached) {
      return cached;
    }

    const detail = await this.codex.getSessionDetail(sessionId, operatorId);
    this.sessionCache.set(sessionId, detail);
    return detail;
  }

  private async resolveSelectedSession(operatorId: string): Promise<string | undefined> {
    const binding = await this.bindings.getUser(operatorId);
    return binding?.lastSelectedSessionId;
  }

  private async findActiveTaskForUser(operatorId: string): Promise<TaskRecord | undefined> {
    const binding = await this.bindings.getUser(operatorId);
    if (!binding?.activeTaskId) {
      return undefined;
    }

    const task = await this.tasks.get(binding.activeTaskId);
    if (task && !isTerminalState(task.state)) {
      return task;
    }

    return undefined;
  }

  private async findLatestTaskForUser(operatorId: string): Promise<TaskRecord | undefined> {
    const binding = await this.bindings.getUser(operatorId);
    if (binding?.activeTaskId) {
      const active = await this.tasks.get(binding.activeTaskId);
      if (active) {
        return active;
      }
    }

    return this.tasks.latestForUser(operatorId);
  }

  private async handleFailure(input: {
    chatId: string;
    operatorId: string;
    action: string;
    error: unknown;
    replyTo?: string;
  }): Promise<void> {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    this.logger.error({ err: input.error, action: input.action }, 'Bridge action failed');
    await this.audit.append({
      timestamp: Date.now(),
      operatorId: input.operatorId,
      action: input.action,
      result: 'failure',
      details: {
        message,
      },
    });
    await this.lark.sendText(input.chatId, `操作失败: ${truncate(message, 200)}`, input.replyTo);
  }

  private coerceAction(value: unknown): CardActionPayload | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const raw = value as Record<string, unknown>;
    const action = typeof raw.action === 'string' ? raw.action : undefined;
    if (!action) {
      return undefined;
    }

    return {
      action,
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : '',
      taskId: typeof raw.taskId === 'string' ? raw.taskId : '',
      page: typeof raw.page === 'number' ? raw.page : undefined,
      decisionToken: typeof raw.decisionToken === 'string' ? raw.decisionToken : '',
      option: typeof raw.option === 'string' ? raw.option : '',
      options: raw.options,
    };
  }
}

interface CardActionPayload {
  action: string;
  sessionId: string;
  taskId: string;
  page?: number;
  decisionToken: string;
  option: string;
  options: unknown;
}

function parseContinueOptions(input: unknown): ContinueOptions {
  if (!input || typeof input !== 'object') {
    return DEFAULT_CONTINUE_OPTIONS;
  }

  const raw = input as Record<string, unknown>;
  return {
    syncLatest: raw.syncLatest === true,
    readOnly: raw.readOnly === true,
    planOnly: raw.planOnly === true,
  };
}

function extractPromptFromCard(event: CardActionEvent): string | undefined {
  const raw = event.raw;
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const candidate = findDeep(raw, ['prompt', 'value']);
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }

  const direct = findDeep(raw, ['prompt']);
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  return undefined;
}

function findDeep(root: unknown, path: string[]): unknown {
  const queue: unknown[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }

    const record = current as Record<string, unknown>;
    let pointer: unknown = record;
    for (const key of path) {
      if (!pointer || typeof pointer !== 'object' || !(key in (pointer as Record<string, unknown>))) {
        pointer = undefined;
        break;
      }
      pointer = (pointer as Record<string, unknown>)[key];
    }
    if (pointer !== undefined) {
      return pointer;
    }

    queue.push(...Object.values(record));
  }

  return undefined;
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
