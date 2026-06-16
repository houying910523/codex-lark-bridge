import pino from 'pino';

import { BridgeApplication } from './app.js';
import { loadConfig } from './config.js';
import { CodexWebSocketClient } from './codex.js';
import { LarkClient } from './lark/LarkClient.js';
import {createHttpServer, ReadinessProvider} from './server.js';
import { AuditRepository, BindingsRepository, DecisionsRepository, TasksRepository } from './storage/repositories.js';
import {CodexGateway} from "./codex/CodexGateway.js";
import {EventDispatcher} from "./event/EventDispatcher.js";
import {Application} from "./Application.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({
    level: config.logLevel,
  });

  const app = new Application(config, logger);
  const httpServer = createHttpServer(config.port, app, logger.child({ component: 'http' }));

  await app.start();
  await httpServer.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    await Promise.allSettled([app.stop(), httpServer.stop()]);
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
