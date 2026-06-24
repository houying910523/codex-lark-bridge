import assert from 'node:assert/strict';
import test from 'node:test';

import pino from 'pino';

import { CodexSocketFileGateway } from '../src/codex/CodexSocketFileGateway.js';
import { EventDispatcher } from '../src/event/EventDispatcher.js';

test('socket gateway requires socketFile', async () => {
  const logger = pino({ enabled: false });
  const gateway = new CodexSocketFileGateway(
    {
      reconnectMs: 100,
    },
    new EventDispatcher(logger),
    logger,
  );

  await assert.rejects(
    gateway.connect(),
    /missing socketFile property/,
  );
});

test('socket gateway is disconnected before connect', () => {
  const logger = pino({ enabled: false });
  const gateway = new CodexSocketFileGateway(
    {
      socketFile: '/tmp/codex.sock',
      reconnectMs: 100,
    },
    new EventDispatcher(logger),
    logger,
  );

  assert.equal(gateway.isConnected(), false);
});
