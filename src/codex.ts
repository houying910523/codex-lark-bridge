import { EventEmitter } from 'node:events';

import type { Logger } from 'pino';
import WebSocket from 'ws';
import { z } from 'zod';

import type { AppConfig } from './config.js';
import type {
  BridgeEvent,
  ContinueOptions,
  SessionDetail,
  SessionSummary,
  SessionStatus,
  TaskSnapshot,
} from './domain/models.js';

const sessionSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  workspace: z.string().optional(),
  lastActiveAt: z.string(),
  status: z.enum(['idle', 'running', 'error', 'unknown']),
  lastSummary: z.string().optional(),
  owner: z.string().optional(),
});

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class CodexProtocolError extends Error {}

export class CodexWebSocketClient extends EventEmitter {
  private ws?: WebSocket;
  private connected = false;
  private intentionallyClosed = false;
  private connectPromise?: Promise<void>;
  private requestId = 1;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly taskSubscribers = new Map<string, Set<(event: BridgeEvent) => Promise<void> | void>>();
  private reconnectTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: AppConfig['codex'],
    private readonly logger: Logger,
  ) {
    super();
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.intentionallyClosed = false;
    this.connectPromise = this.openSocket();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  async disconnect(): Promise<void> {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (!this.ws) {
      this.connected = false;
      return;
    }

    await new Promise<void>((resolve) => {
      this.ws?.once('close', () => resolve());
      this.ws?.close();
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async listSessions(operatorId: string): Promise<SessionSummary[]> {
    const result = await this.request<unknown>(this.config.methods.listSessions, {
      operatorId,
    });

    return coerceSessionArray(result);
  }

  async getSessionDetail(sessionId: string, operatorId: string): Promise<SessionDetail> {
    const result = await this.request<unknown>(this.config.methods.getSession, {
      sessionId,
      operatorId,
    });

    return coerceSessionDetail(result, sessionId);
  }

  async continueSession(
    sessionId: string,
    prompt: string,
    options: ContinueOptions,
    operatorId: string,
  ): Promise<{ taskId: string }> {
    const result = await this.request<unknown>(this.config.methods.continueSession, {
      sessionId,
      prompt,
      options,
      operatorId,
    });

    const taskId = firstString(result, ['taskId', 'task_id', 'runId', 'run_id']);
    if (!taskId) {
      throw new CodexProtocolError('continueSession response missing task id');
    }

    return { taskId };
  }

  async cancelTask(taskId: string, operatorId: string): Promise<void> {
    await this.request(this.config.methods.cancelTask, { taskId, operatorId });
  }

  async submitDecision(
    taskId: string,
    decisionToken: string,
    option: string,
    operatorId: string,
  ): Promise<void> {
    await this.request(this.config.methods.submitDecision, {
      taskId,
      decisionToken,
      option,
      operatorId,
    });
  }

  async getTaskSnapshot(taskId: string): Promise<TaskSnapshot> {
    const result = await this.request<unknown>(this.config.methods.getTask, {
      taskId,
    });

    return coerceSnapshot(result, taskId);
  }

  async subscribeTaskEvents(
    taskId: string,
    handler: (event: BridgeEvent) => Promise<void> | void,
  ): Promise<() => void> {
    const handlers = this.taskSubscribers.get(taskId) ?? new Set();
    handlers.add(handler);
    this.taskSubscribers.set(taskId, handlers);

    if (this.config.methods.subscribeTask) {
      await this.request(this.config.methods.subscribeTask, { taskId });
    }

    return () => {
      const current = this.taskSubscribers.get(taskId);
      if (!current) {
        return;
      }

      current.delete(handler);
      if (current.size === 0) {
        this.taskSubscribers.delete(taskId);
      }
    };
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.info({ url: this.config.wsUrl }, 'Connecting to Codex WebSocket');
      const ws = new WebSocket(this.config.wsUrl, {
        handshakeTimeout: this.config.handshakeTimeoutMs,
      });
      this.ws = ws;

      let settled = false;

      ws.on('open', async () => {
        this.connected = true;
        this.logger.info('Connected to Codex WebSocket');
        this.emit('connected');
        if (!settled) {
          settled = true;
          resolve();
        }

        await this.resubscribeAll();
      });

      ws.on('message', async (payload: { toString(): string }) => {
        await this.handleMessage(payload.toString());
      });

      ws.on('error', (error: Error) => {
        this.logger.error({ err: error }, 'Codex WebSocket error');
        this.emit('error', error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      ws.on('close', () => {
        this.connected = false;
        this.logger.warn('Codex WebSocket closed');
        this.emit('disconnected');
        this.rejectAllPending(new CodexProtocolError('Codex WebSocket disconnected'));
        if (!this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionallyClosed) {
      return;
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        await this.connect();
      } catch (error) {
        this.logger.error({ err: error }, 'Failed to reconnect Codex WebSocket');
        this.scheduleReconnect();
      }
    }, this.config.reconnectMs);
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private async request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new CodexProtocolError('Codex WebSocket is not connected');
    }

    const id = this.requestId++;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new CodexProtocolError(`Codex request timed out: ${method}`));
      }, 20_000);

      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      ws.send(payload, (error?: Error) => {
        if (!error) {
          return;
        }

        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      });
    });
  }

  private async handleMessage(raw: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      this.logger.warn({ raw, err: error }, 'Received non-JSON Codex payload');
      return;
    }

    if (!message || typeof message !== 'object') {
      return;
    }

    const envelope = message as Record<string, unknown>;
    if (typeof envelope.id === 'number' && (envelope.result !== undefined || envelope.error !== undefined)) {
      const pending = this.pendingRequests.get(envelope.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pendingRequests.delete(envelope.id);

      if (envelope.error) {
        pending.reject(new CodexProtocolError(JSON.stringify(envelope.error)));
      } else {
        pending.resolve(envelope.result);
      }
      return;
    }

    if (typeof envelope.method !== 'string') {
      return;
    }

    const event = normalizeBridgeEvent(envelope.method, envelope.params);
    if (!event) {
      return;
    }

    const subscribers = this.taskSubscribers.get(event.taskId ?? '');
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    for (const handler of subscribers) {
      await handler(event);
    }
  }

  private async resubscribeAll(): Promise<void> {
    if (!this.config.methods.subscribeTask || this.taskSubscribers.size === 0) {
      return;
    }

    for (const taskId of this.taskSubscribers.keys()) {
      try {
        await this.request(this.config.methods.subscribeTask, { taskId });
      } catch (error) {
        this.logger.warn({ err: error, taskId }, 'Failed to resubscribe task after reconnect');
      }
    }
  }
}

function normalizeBridgeEvent(method: string, params: unknown): BridgeEvent | undefined {
  if (!params || typeof params !== 'object') {
    return undefined;
  }

  const payload = params as Record<string, unknown>;
  const taskId = firstString(payload, ['taskId', 'task_id', 'runId', 'run_id']);
  const sessionId = firstString(payload, ['sessionId', 'session_id']) ?? 'unknown-session';
  const eventType = normalizeEventType(method, payload);

  if (!taskId || !eventType) {
    return undefined;
  }

  return {
    eventId:
      firstString(payload, ['eventId', 'event_id']) ??
      `${taskId}:${String(payload.sequence ?? payload.seq ?? Date.now())}`,
    eventType,
    sessionId,
    taskId,
    sequence: coerceNumber(payload.sequence ?? payload.seq) ?? 0,
    timestamp: coerceNumber(payload.timestamp ?? payload.created_at) ?? Date.now(),
    summary:
      firstString(payload, ['summary', 'message', 'content']) ??
      firstString(payload.phase as Record<string, unknown> | undefined, ['name']),
    payload,
  };
}

function normalizeEventType(method: string, payload: Record<string, unknown>): BridgeEvent['eventType'] | undefined {
  const candidate = `${method}:${String(payload.event_type ?? payload.type ?? payload.status ?? '')}`.toLowerCase();

  if (candidate.includes('created') || candidate.includes('start')) {
    return 'task_created';
  }
  if (candidate.includes('phase')) {
    return 'task_phase_changed';
  }
  if (candidate.includes('output') || candidate.includes('delta') || candidate.includes('chunk')) {
    return 'task_output_appended';
  }
  if (candidate.includes('confirm') || candidate.includes('approval') || payload.decisionToken || payload.decision_token) {
    return 'task_confirmation_required';
  }
  if (candidate.includes('artifact')) {
    return 'task_artifact_ready';
  }
  if (candidate.includes('success') || candidate.includes('succeed') || payload.status === 'succeeded') {
    return 'task_succeeded';
  }
  if (candidate.includes('failed') || candidate.includes('error') || payload.status === 'failed') {
    return 'task_failed';
  }
  if (candidate.includes('cancel')) {
    return 'task_cancelled';
  }

  return undefined;
}

function coerceSessionArray(result: unknown): SessionSummary[] {
  const items = extractArray(result, ['sessions', 'items']) ?? (Array.isArray(result) ? result : []);

  return items
    .map((item) => coerceSessionSummary(item))
    .filter((item): item is SessionSummary => Boolean(item));
}

function coerceSessionSummary(input: unknown): SessionSummary | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const raw = input as Record<string, unknown>;
  const sessionId = firstString(raw, ['sessionId', 'session_id', 'id']);
  const title = firstString(raw, ['title', 'name']) ?? sessionId;
  const lastActiveAt = firstString(raw, ['lastActiveAt', 'last_active_at', 'updatedAt', 'updated_at']) ?? new Date().toISOString();
  if (!sessionId || !title) {
    return undefined;
  }

  const summary = {
    sessionId,
    title,
    repo: firstString(raw, ['repo', 'repository']),
    branch: firstString(raw, ['branch']),
    workspace: firstString(raw, ['workspace', 'cwd']),
    lastActiveAt,
    status: normalizeSessionStatus(firstString(raw, ['status', 'session_status'])),
    lastSummary: firstString(raw, ['lastSummary', 'last_summary', 'summary']),
    owner: firstString(raw, ['owner', 'operator']),
  };

  return sessionSchema.parse(summary);
}

function coerceSessionDetail(result: unknown, fallbackSessionId: string): SessionDetail {
  const base = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const summary = coerceSessionSummary(base) ?? {
    sessionId: fallbackSessionId,
    title: fallbackSessionId,
    lastActiveAt: new Date().toISOString(),
    status: 'unknown' as SessionStatus,
  };

  return {
    ...summary,
    recentMessages: extractStringArray(base, ['recentMessages', 'recent_messages', 'messages']),
    recentFiles: extractStringArray(base, ['recentFiles', 'recent_files', 'files']),
    lastTaskSummary: firstString(base, ['lastTaskSummary', 'last_task_summary']),
  };
}

function coerceSnapshot(result: unknown, fallbackTaskId: string): TaskSnapshot {
  const raw = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const taskId = firstString(raw, ['taskId', 'task_id', 'runId', 'run_id']) ?? fallbackTaskId;
  const sessionId = firstString(raw, ['sessionId', 'session_id']) ?? 'unknown-session';
  return {
    taskId,
    sessionId,
    state: normalizeTaskState(firstString(raw, ['state', 'status'])),
    phase: firstString(raw, ['phase']),
    summary: firstString(raw, ['summary', 'message']),
    errorMessage: firstString(raw, ['error', 'errorMessage', 'error_message']),
    sequence: coerceNumber(raw.sequence ?? raw.seq),
  };
}

function extractArray(value: unknown, keys: string[]): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(raw[key])) {
      return raw[key] as unknown[];
    }
  }

  return undefined;
}

function extractStringArray(value: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const item = value[key];
    if (!Array.isArray(item)) {
      continue;
    }

    return item.filter((entry): entry is string => typeof entry === 'string');
  }

  return [];
}

function normalizeSessionStatus(input: string | undefined): SessionStatus {
  switch (input?.toLowerCase()) {
    case 'idle':
      return 'idle';
    case 'running':
      return 'running';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return 'unknown';
  }
}

function normalizeTaskState(input: string | undefined): TaskSnapshot['state'] {
  switch (input?.toLowerCase()) {
    case 'pending':
      return 'Pending';
    case 'starting':
      return 'Starting';
    case 'running':
      return 'Running';
    case 'waitingdecision':
    case 'waiting_user_decision':
    case 'waiting':
      return 'WaitingDecision';
    case 'cancelling':
      return 'Cancelling';
    case 'succeeded':
    case 'success':
      return 'Succeeded';
    case 'failed':
    case 'error':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Running';
  }
}

function firstString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = raw[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const next = Number(value);
    if (Number.isFinite(next)) {
      return next;
    }
  }

  return undefined;
}
