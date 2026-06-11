import type { BridgeEvent, PendingDecision, TaskRecord, TaskState, TaskSnapshot, ViewState } from './models.js';
import { formatDateTime, isTerminalState, truncate } from './models.js';

export function createInitialTaskRecord(input: {
  taskId: string;
  sessionId: string;
  sessionTitle?: string;
  repo?: string;
  branch?: string;
  operatorId: string;
  chatId: string;
  messageId?: string;
  promptDigest: string;
  startedAt?: number;
}): TaskRecord {
  const now = input.startedAt ?? Date.now();

  return {
    taskId: input.taskId,
    sessionId: input.sessionId,
    sessionTitle: input.sessionTitle,
    repo: input.repo,
    branch: input.branch,
    operatorId: input.operatorId,
    chatId: input.chatId,
    messageId: input.messageId,
    promptDigest: input.promptDigest,
    state: 'Starting',
    viewState: 'RunningView',
    summaries: [],
    startedAt: now,
    updatedAt: now,
    lastSequence: 0,
  };
}

export function reduceTaskEvent(task: TaskRecord, event: BridgeEvent): {
  task: TaskRecord;
  decision?: PendingDecision;
} {
  const next: TaskRecord = {
    ...task,
    updatedAt: event.timestamp,
    lastSequence: Math.max(task.lastSequence, event.sequence),
    lastEventId: event.eventId,
  };

  if (event.summary) {
    next.summaries = appendSummary(next.summaries, event.summary);
  }

  let decision: PendingDecision | undefined;

  switch (event.eventType) {
    case 'task_created':
      next.state = 'Running';
      next.viewState = 'RunningView';
      break;
    case 'task_phase_changed':
      next.state = isTerminalState(next.state) ? next.state : 'Running';
      next.viewState = isTerminalState(next.state) ? next.viewState : 'RunningView';
      next.phase = stringFromPayload(event.payload, 'phase') ?? event.summary ?? next.phase;
      break;
    case 'task_output_appended':
      if (!isTerminalState(next.state)) {
        next.state = 'Running';
        next.viewState = 'RunningView';
      }
      break;
    case 'task_confirmation_required':
      next.state = 'WaitingDecision';
      next.viewState = 'ConfirmationView';
      next.phase = stringFromPayload(event.payload, 'phase') ?? next.phase ?? 'Waiting for confirmation';
      decision = {
        taskId: next.taskId,
        decisionToken: stringFromPayload(event.payload, 'decisionToken') ?? next.taskId,
        title: stringFromPayload(event.payload, 'title') ?? 'Confirmation required',
        description: stringFromPayload(event.payload, 'description'),
        options: coerceDecisionOptions(event.payload?.options),
        expireAt: numberFromPayload(event.payload, 'expireAt'),
        defaultOption: stringFromPayload(event.payload, 'defaultOption'),
        createdAt: event.timestamp,
      };
      break;
    case 'task_artifact_ready':
      if (!isTerminalState(next.state)) {
        next.state = 'Running';
      }
      break;
    case 'task_succeeded':
      next.state = 'Succeeded';
      next.viewState = 'SuccessView';
      next.endedAt = event.timestamp;
      next.phase = 'Completed';
      next.completionSummary = event.summary ?? stringFromPayload(event.payload, 'summary');
      break;
    case 'task_failed':
      next.state = 'Failed';
      next.viewState = 'FailedView';
      next.endedAt = event.timestamp;
      next.phase = 'Failed';
      next.errorMessage =
        event.summary ??
        stringFromPayload(event.payload, 'error') ??
        stringFromPayload(event.payload, 'message') ??
        'Task failed';
      break;
    case 'task_cancelled':
      next.state = 'Cancelled';
      next.viewState = 'CancelledView';
      next.endedAt = event.timestamp;
      next.phase = 'Cancelled';
      break;
    default:
      break;
  }

  return { task: next, decision };
}

export function applyTaskSnapshot(task: TaskRecord, snapshot: TaskSnapshot, timestamp = Date.now()): TaskRecord {
  const next: TaskRecord = {
    ...task,
    updatedAt: timestamp,
    lastSequence: Math.max(task.lastSequence, snapshot.sequence ?? task.lastSequence),
    phase: snapshot.phase ?? task.phase,
  };

  if (snapshot.summary) {
    next.summaries = appendSummary(next.summaries, snapshot.summary);
  }

  switch (snapshot.state) {
    case 'Pending':
    case 'Starting':
    case 'Running':
      next.state = snapshot.state === 'Pending' ? 'Starting' : snapshot.state;
      next.viewState = 'RunningView';
      break;
    case 'WaitingDecision':
      next.state = 'WaitingDecision';
      next.viewState = 'ConfirmationView';
      break;
    case 'Cancelling':
      next.state = 'Cancelling';
      next.viewState = 'RunningView';
      break;
    case 'Succeeded':
      next.state = 'Succeeded';
      next.viewState = 'SuccessView';
      next.endedAt = next.endedAt ?? timestamp;
      next.completionSummary = snapshot.summary ?? next.completionSummary;
      break;
    case 'Failed':
      next.state = 'Failed';
      next.viewState = 'FailedView';
      next.endedAt = next.endedAt ?? timestamp;
      next.errorMessage = snapshot.errorMessage ?? snapshot.summary ?? next.errorMessage;
      break;
    case 'Cancelled':
      next.state = 'Cancelled';
      next.viewState = 'CancelledView';
      next.endedAt = next.endedAt ?? timestamp;
      break;
  }

  return next;
}

export function toTerminalSummary(task: TaskRecord): string {
  if (task.state === 'Succeeded') {
    return task.completionSummary ?? task.summaries.at(-1) ?? 'Task completed successfully';
  }

  if (task.state === 'Failed') {
    return task.errorMessage ?? task.summaries.at(-1) ?? 'Task failed';
  }

  if (task.state === 'Cancelled') {
    return task.summaries.at(-1) ?? 'Task was cancelled';
  }

  return `Task is ${task.state} as of ${formatDateTime(task.updatedAt)}`;
}

export function toViewState(state: TaskState): ViewState {
  switch (state) {
    case 'WaitingDecision':
      return 'ConfirmationView';
    case 'Succeeded':
      return 'SuccessView';
    case 'Failed':
      return 'FailedView';
    case 'Cancelled':
      return 'CancelledView';
    default:
      return 'RunningView';
  }
}

function appendSummary(existing: string[], summary: string): string[] {
  const cleaned = truncate(summary.trim(), 280);
  if (!cleaned) {
    return existing;
  }

  const next = [...existing, cleaned];
  return next.slice(-5);
}

function stringFromPayload(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberFromPayload(payload: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = payload?.[key];
  return typeof value === 'number' ? value : undefined;
}

function coerceDecisionOptions(payload: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(payload)) {
    return [
      { label: 'Approve', value: 'approve' },
      { label: 'Reject', value: 'reject' },
    ];
  }

  const options = payload
    .map((item) => {
      if (typeof item === 'string') {
        return { label: item, value: item };
      }

      if (item && typeof item === 'object') {
        const candidate = item as Record<string, unknown>;
        const label = typeof candidate.label === 'string' ? candidate.label : undefined;
        const value = typeof candidate.value === 'string' ? candidate.value : undefined;
        if (label && value) {
          return { label, value };
        }
      }

      return undefined;
    })
    .filter((item): item is { label: string; value: string } => Boolean(item));

  return options.length > 0 ? options : [{ label: 'Continue', value: 'continue' }];
}
