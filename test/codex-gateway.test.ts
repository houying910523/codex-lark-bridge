import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { WebSocketServer } from 'ws';

import { CodexGateway } from '../src/codex/index.js';

test('CodexGateway manages websocket connection lifecycle and raw messages', async () => {
  const server = new WebSocketServer({
    port: 0,
  });

  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unexpected WebSocket server address');
    }

    const gateway = new CodexGateway({
      wsUrl: `ws://127.0.0.1:${address.port}`,
      reconnectMs: 25,
    });

    const lifecycle: string[] = [];
    const messages: string[] = [];

    gateway.onConnected(() => {
      lifecycle.push('connected');
    });
    gateway.onDisconnected(() => {
      lifecycle.push('disconnected');
    });
    gateway.onMessage((payload) => {
      messages.push(payload);
    });

    server.on('connection', (socket) => {
      socket.on('message', (payload) => {
        socket.send(`echo:${payload.toString()}`);
      });
    });

    await gateway.connect();
    await gateway.send('hello');

    for (let attempt = 0; attempt < 20 && messages.length === 0; attempt += 1) {
      await delay(10);
    }

    assert.equal(gateway.isConnected(), true);
    assert.deepEqual(lifecycle, ['connected']);
    assert.deepEqual(messages, ['echo:hello']);

    await gateway.disconnect();

    assert.equal(gateway.isConnected(), false);
    assert.deepEqual(lifecycle, ['connected', 'disconnected']);
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
