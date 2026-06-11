import pino from 'pino';

import { BridgeApplication } from './app.js';
import { loadConfig } from './config.js';
import { CodexWebSocketClient } from './codex.js';
import { LarkClient } from './lark-client.js';
import { createHttpServer } from './server.js';
import { AuditRepository, BindingsRepository, DecisionsRepository, TasksRepository } from './storage/repositories.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({
    level: config.logLevel,
  });

  const bindings = new BindingsRepository(config.dataDir);
  const tasks = new TasksRepository(config.dataDir);
  const decisions = new DecisionsRepository(config.dataDir);
  const audit = new AuditRepository(config.dataDir);

  const lark = new LarkClient(config.lark, logger.child({ component: 'lark' }));
  const codex = new CodexWebSocketClient(config.codex, logger.child({ component: 'codex' }));
  const app = new BridgeApplication(
    config,
    logger.child({ component: 'bridge' }),
    lark,
    codex,
    bindings,
    tasks,
    decisions,
    audit,
  );
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
