import assert from 'node:assert/strict';
import test from 'node:test';

import { applyTaskSnapshot, createInitialTaskRecord, reduceTaskEvent } from '../src/domain/state.js';

test('reduceTaskEvent moves task into waiting decision', () => {
  const initial = createInitialTaskRecord({
    taskId: 'task-1',
    sessionId: 'session-1',
    operatorId: 'user-1',
    chatId: 'chat-1',
    promptDigest: 'do something',
  });

  const { task, decision } = reduceTaskEvent(initial, {
    eventId: 'evt-1',
    eventType: 'task_confirmation_required',
    sessionId: 'session-1',
    taskId: 'task-1',
    sequence: 2,
    timestamp: Date.now(),
    summary: 'Need approval',
    payload: {
      decisionToken: 'token-1',
      title: 'Apply patch?',
      options: [{ label: 'Approve', value: 'approve' }],
    },
  });

  assert.equal(task.state, 'WaitingDecision');
  assert.equal(task.viewState, 'ConfirmationView');
  assert.equal(decision?.decisionToken, 'token-1');
});

test('applyTaskSnapshot preserves terminal state details', () => {
  const initial = createInitialTaskRecord({
    taskId: 'task-2',
    sessionId: 'session-2',
    operatorId: 'user-2',
    chatId: 'chat-2',
    promptDigest: 'summarize',
  });

  const updated = applyTaskSnapshot(initial, {
    taskId: 'task-2',
    sessionId: 'session-2',
    state: 'Succeeded',
    summary: 'All checks passed',
  });

  assert.equal(updated.state, 'Succeeded');
  assert.equal(updated.viewState, 'SuccessView');
  assert.equal(updated.completionSummary, 'All checks passed');
});
