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
  CODEX_WS_URL: wsUrlSchema,
  CODEX_WS_HANDSHAKE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  CODEX_WS_RECONNECT_MS: z.coerce.number().int().positive().default(3_000),
  OUTPUT_THROTTLE_MS: z.coerce.number().int().positive().default(3_000),
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
    wsUrl: string;
    handshakeTimeoutMs: number;
    reconnectMs: number;
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
      wsUrl: parsed.CODEX_WS_URL,
      handshakeTimeoutMs: parsed.CODEX_WS_HANDSHAKE_TIMEOUT_MS,
      reconnectMs: parsed.CODEX_WS_RECONNECT_MS,
    },
    outputThrottleMs: parsed.OUTPUT_THROTTLE_MS,
  };
}
