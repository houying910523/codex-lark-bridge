export type SessionStatus = 'idle' | 'running' | 'error' | 'unknown';

export interface SessionSummary {
  sessionId: string;
  title: string;
  workspace?: string;
  lastActiveAt: string;
  status: string;
}

export interface SessionDetail extends SessionSummary {
  recentMessages: string[];
  recentFiles: string[];
  lastTaskSummary?: string;
  repo?: string;
  branch?: string;
  lastSummary?: string;
  owner?: string;
}

export interface ContinueOptions {
  syncLatest: boolean;
  readOnly: boolean;
  planOnly: boolean;
}

export type ViewState =
  | 'ListView'
  | 'DetailView'
  | 'InputView'
  | 'RunningView'
  | 'ConfirmationView'
  | 'SuccessView'
  | 'FailedView'
  | 'CancelledView';

export type TaskState =
  | 'Pending'
  | 'Starting'
  | 'Running'
  | 'WaitingDecision'
  | 'Cancelling'
  | 'Succeeded'
  | 'Failed'
  | 'Cancelled';

export interface PendingDecision {
  taskId: string;
  decisionToken: string;
  title: string;
  description?: string;
  options: Array<{
    label: string;
    value: string;
  }>;
  expireAt?: number;
  defaultOption?: string;
  createdAt: number;
}

export interface TaskRecord {
  taskId: string;
  sessionId: string;
  sessionTitle?: string;
  repo?: string;
  branch?: string;
  operatorId: string;
  chatId: string;
  messageId?: string;
  promptDigest: string;
  state: TaskState;
  viewState: ViewState;
  phase?: string;
  summaries: string[];
  startedAt: number;
  endedAt?: number;
  updatedAt: number;
  lastSequence: number;
  lastEventId?: string;
  errorMessage?: string;
  completionSummary?: string;
}

export interface UserBinding {
  larkUserId: string;
  chatId: string;
  lastSelectedSessionId?: string;
  activeTaskId?: string;
  updatedAt: number;
}

export interface MessageBinding {
  messageId: string;
  chatId: string;
  cardType: 'sessions' | 'detail' | 'input' | 'running' | 'confirmation' | 'terminal';
  sessionId?: string;
  taskId?: string;
  updatedAt: number;
}

export interface IdempotencyRecord {
  key: string;
  taskId?: string;
  action: string;
  createdAt: number;
}

export interface BindingsData {
  users: Record<string, UserBinding>;
  messages: Record<string, MessageBinding>;
  idempotency: Record<string, IdempotencyRecord>;
}

export interface TasksData {
  tasks: Record<string, TaskRecord>;
}

export interface DecisionsData {
  items: Record<string, PendingDecision>;
}

export type BridgeEventType =
  | 'session_list_loaded'
  | 'session_detail_loaded'
  | 'task_created'
  | 'task_phase_changed'
  | 'task_output_appended'
  | 'task_confirmation_required'
  | 'task_artifact_ready'
  | 'task_succeeded'
  | 'task_failed'
  | 'task_cancelled'
  | 'delivery_failed';

export interface BridgeEvent {
  eventId: string;
  eventType: BridgeEventType;
  sessionId: string;
  taskId?: string;
  sequence: number;
  timestamp: number;
  summary?: string;
  payload?: Record<string, unknown>;
}

export interface TaskSnapshot {
  taskId: string;
  sessionId: string;
  state: TaskState;
  phase?: string;
  summary?: string;
  errorMessage?: string;
  sequence?: number;
}

export interface AuditEntry {
  timestamp: number;
  operatorId: string;
  action: string;
  targetId?: string;
  result: 'success' | 'failure';
  details?: Record<string, unknown>;
}

export const DEFAULT_CONTINUE_OPTIONS: ContinueOptions = {
  syncLatest: false,
  readOnly: false,
  planOnly: false,
};

export function isTerminalState(state: TaskState): boolean {
  return state === 'Succeeded' || state === 'Failed' || state === 'Cancelled';
}

export function digestPrompt(prompt: string): string {
  return truncate(prompt.replace(/\s+/g, ' ').trim(), 120);
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19);
}
