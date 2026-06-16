import assert from 'node:assert/strict';
import test from 'node:test';

import { EventDispatcher } from '../src/event/index.js';

test('EventDispatcher publishes events to matching handlers', async () => {
  const dispatcher = new EventDispatcher();
  const received: string[] = [];

  dispatcher.registerHandler(
    {
      target: 'codex',
    },
    async (event) => {
      received.push(`${event.source}:${event.action}`);
    },
  );
  dispatcher.registerHandler(
    {
      target: 'lark',
    },
    async () => {
      received.push('should-not-run');
    },
  );

  await dispatcher.publish({
    target: 'codex',
    source: 'app',
    action: 'connected',
    data: {
      sessionId: 'session-1',
    },
  });

  assert.deepEqual(received, ['app:connected']);
});

test('EventDispatcher unregisters handlers', async () => {
  const dispatcher = new EventDispatcher();
  const received: string[] = [];

  const unregister = dispatcher.registerHandler(
    {
      action: 'message',
    },
    async (event) => {
      received.push(event.action);
    },
  );

  unregister();

  await dispatcher.publish({
    target: 'codex',
    source: 'gateway',
    action: 'message',
    data: {},
  });

  assert.deepEqual(received, []);
});

test('EventDispatcher continues invoking handlers when one handler fails', async () => {
  const dispatcher = new EventDispatcher();
  const received: string[] = [];

  dispatcher.registerHandler({}, async () => {
    throw new Error('boom');
  });
  dispatcher.registerHandler({}, async (event) => {
    received.push(event.action);
  });

  await assert.rejects(
    dispatcher.publish({
      target: 'codex',
      source: 'gateway',
      action: 'message',
      data: {},
    }),
    AggregateError,
  );

  assert.deepEqual(received, ['message']);
});
