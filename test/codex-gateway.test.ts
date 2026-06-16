import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import pino from 'pino';
import { WebSocketServer } from 'ws';

import { CodexEvent, CodexGateway } from '../src/codex/CodexGateway.js';
import { EventDispatcher } from '../src/event/EventDispatcher.js';

test('CodexGateway publishes response events from websocket messages', async () => {
  const server = new WebSocketServer({
    port: 0,
  });

  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unexpected WebSocket server address');
    }

    const dispatcher = new EventDispatcher<CodexEvent>(pino({ enabled: false }));
    const gateway = new CodexGateway(
      {
        wsUrl: `ws://127.0.0.1:${address.port}`,
        reconnectMs: 25,
      },
      dispatcher,
      pino({ enabled: false }),
    );

    const receivedMethods: string[] = [];
    dispatcher.registerHandler('codex-gateway', async (event) => {
      receivedMethods.push(event.method);
    });

    server.on('connection', (socket) => {
      socket.on('message', (payload: Buffer) => {
        const request = JSON.parse(payload.toString());
        socket.send(JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            ok: true,
          },
        }));
      });
    });

    await gateway.send('hello', { text: 'world' });

    for (let attempt = 0; attempt < 20 && !receivedMethods.includes('hello'); attempt += 1) {
      await delay(10);
    }

    assert.equal(gateway.isConnected(), true);
    assert.deepEqual(receivedMethods, ['initialize', 'hello']);

    await gateway.disconnect();

    assert.equal(gateway.isConnected(), false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
});
