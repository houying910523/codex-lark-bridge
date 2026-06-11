import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BindingsRepository, TasksRepository } from '../src/storage/repositories.js';

test('bindings repository persists user and idempotency state', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'codex-lark-bindings-'));
  try {
    const repo = new BindingsRepository(dataDir);
    await repo.upsertUser({
      larkUserId: 'user-1',
      chatId: 'chat-1',
      lastSelectedSessionId: 'session-1',
      activeTaskId: 'task-1',
      updatedAt: Date.now(),
    });
    await repo.rememberIdempotency({
      key: 'k-1',
      action: 'continue',
      taskId: 'task-1',
      createdAt: Date.now(),
    });

    const reopened = new BindingsRepository(dataDir);
    const user = await reopened.getUser('user-1');
    const idempotency = await reopened.getIdempotency('k-1');

    assert.equal(user?.lastSelectedSessionId, 'session-1');
    assert.equal(idempotency?.taskId, 'task-1');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('tasks repository returns active tasks only', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'codex-lark-tasks-'));
  try {
    const repo = new TasksRepository(dataDir);
    await repo.put({
      taskId: 'active',
      sessionId: 'session-1',
      operatorId: 'user-1',
      chatId: 'chat-1',
      promptDigest: 'prompt',
      state: 'Running',
      viewState: 'RunningView',
      summaries: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      lastSequence: 0,
    });
    await repo.put({
      taskId: 'done',
      sessionId: 'session-2',
      operatorId: 'user-1',
      chatId: 'chat-1',
      promptDigest: 'prompt',
      state: 'Succeeded',
      viewState: 'SuccessView',
      summaries: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      lastSequence: 0,
      endedAt: Date.now(),
    });

    const active = await repo.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0]?.taskId, 'active');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
