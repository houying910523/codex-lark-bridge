import path from 'node:path';
import { z } from 'zod';

const wsUrlSchema = z
  .string()
  .trim()
  .regex(/^wss?:\/\//, 'must be a ws:// or wss:// URL');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATA_DIR: z.string().trim().default('.data'),
  LARK_APP_ID: z.string().trim().min(1, 'LARK_APP_ID is required'),
  LARK_APP_SECRET: z.string().trim().min(1, 'LARK_APP_SECRET is required'),
  LARK_DOMAIN: z.string().trim().optional(),
  CODEX_WS_URL: wsUrlSchema.optional(),
  CODEX_WS_HANDSHAKE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  CODEX_WS_RECONNECT_MS: z.coerce.number().int().positive().default(3_000),
  CODEX_SOCKET_FILE: z.string().trim().optional(),
  CODEX_CONNECT_TYPE: z.enum(['websocket', 'socket']).default('websocket'),
  OUTPUT_THROTTLE_MS: z.coerce.number().int().positive().default(3_000),

  CODEX_SESSION_CWD: z.string().trim().optional(),
  CODEX_SESSION_SOURCE: z.string().trim().default('codex-lark-bridge')
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  dataDir: string;
  lark: {
    appId: string;
    appSecret: string;
    domain?: string;
  };
  codex: {
    type: 'websocket' | 'socket';
    wsUrl?: string;
    socketFile?: string;
    handshakeTimeoutMs: number;
    reconnectMs: number;
  };
  controller: {
    cwd?: string,
    source: string,
  };
  outputThrottleMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    dataDir: path.resolve(parsed.DATA_DIR),
    lark: {
      appId: parsed.LARK_APP_ID,
      appSecret: parsed.LARK_APP_SECRET,
      domain: parsed.LARK_DOMAIN,
    },
    codex: {
      type: parsed.CODEX_CONNECT_TYPE,
      wsUrl: parsed.CODEX_WS_URL,
      socketFile: parsed.CODEX_SOCKET_FILE,
      handshakeTimeoutMs: parsed.CODEX_WS_HANDSHAKE_TIMEOUT_MS,
      reconnectMs: parsed.CODEX_WS_RECONNECT_MS,
    },
    controller: {
      cwd: parsed.CODEX_SESSION_CWD,
      source: parsed.CODEX_SESSION_SOURCE,
    },
    outputThrottleMs: parsed.OUTPUT_THROTTLE_MS,
  };
}
