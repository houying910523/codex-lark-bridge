import assert from 'node:assert/strict';
import test from 'node:test';
import pino from 'pino';

import { EventDispatcher } from '../src/event/EventDispatcher.js';

test('EventDispatcher publishes events to matching handlers', async () => {
  const dispatcher = new EventDispatcher<{ source: string; action: string }>(pino({ enabled: false }));
  const received: string[] = [];

  dispatcher.registerHandler(
    'codex',
    async (event) => {
      received.push(`${event.source}:${event.action}`);
    },
  );
  dispatcher.registerHandler(
    'other',
    async () => {
      received.push('should-not-run');
    },
  );

  await dispatcher.publish({
    source: 'codex',
    action: 'connected',
  });

  assert.deepEqual(received, ['codex:connected']);
});

test('EventDispatcher unregisters handlers', async () => {
  const dispatcher = new EventDispatcher<{ source: string; action: string }>(pino({ enabled: false }));
  const received: string[] = [];

  const unregister = dispatcher.registerHandler(
    'gateway',
    async (event) => {
      received.push(event.action);
    },
  );

  unregister();

  await dispatcher.publish({
    source: 'gateway',
    action: 'message',
  });

  assert.deepEqual(received, []);
});

test('EventDispatcher invokes all handlers for the same source', async () => {
  const dispatcher = new EventDispatcher<{ source: string; action: string }>(pino({ enabled: false }));
  const received: string[] = [];

  dispatcher.registerHandler('lark', async (event) => {
    received.push(`session:${event.action}`);
  });
  dispatcher.registerHandler('lark', async (event) => {
    received.push(`task:${event.action}`);
  });

  await dispatcher.publish({
    source: 'lark',
    action: 'message',
  });

  assert.deepEqual(received, ['session:message', 'task:message']);
});

test('EventDispatcher continues invoking handlers when one handler fails', async () => {
  const dispatcher = new EventDispatcher<{ source: string; action: string }>(pino({ enabled: false }));
  const received: string[] = [];

  dispatcher.registerHandler('gateway', async () => {
    throw new Error('boom');
  });
  dispatcher.registerHandler('gateway', async (event) => {
    received.push(event.action);
  });

  await dispatcher.publish({
    source: 'gateway',
    action: 'message',
  });

  assert.deepEqual(received, ['message']);
});
