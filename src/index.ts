import pino from 'pino';
import {loadConfig} from './config.js';
import {createHttpServer} from './server.js';
import {App} from "./app";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({
    level: config.logLevel,
  });

  const app = new App(config, logger);
  const httpServer = createHttpServer(config.port, app, logger.child({ component: 'http' }));

  await app.start();
  await httpServer.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    await Promise.all([app.stop(), httpServer.stop()]);
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
