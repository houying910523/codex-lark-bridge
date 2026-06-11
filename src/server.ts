import type { Server } from 'node:http';
import http from 'node:http';

import express from 'express';
import type { Logger } from 'pino';

export interface ReadinessProvider {
  getReadiness(): {
    started: boolean;
    larkConnected: boolean;
    codexConnected: boolean;
  };
}

export function createHttpServer(
  port: number,
  readiness: ReadinessProvider,
  logger: Logger,
): {
  start: () => Promise<Server>;
  stop: () => Promise<void>;
} {
  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (_request, response) => {
    response.json({
      ok: true,
      uptime: process.uptime(),
    });
  });

  app.get('/readyz', (_request, response) => {
    const status = readiness.getReadiness();
    const ready = status.started && status.larkConnected && status.codexConnected;
    response.status(ready ? 200 : 503).json({
      ok: ready,
      ...status,
    });
  });

  const server = http.createServer(app);

  return {
    start: () =>
      new Promise((resolve) => {
        server.listen(port, () => {
          logger.info({ port }, 'HTTP server listening');
          resolve(server);
        });
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}
