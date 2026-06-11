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
  CODEX_METHOD_LIST_SESSIONS: z.string().trim().default('sessions/list'),
  CODEX_METHOD_GET_SESSION: z.string().trim().default('sessions/get'),
  CODEX_METHOD_CONTINUE_SESSION: z.string().trim().default('sessions/continue'),
  CODEX_METHOD_CANCEL_TASK: z.string().trim().default('tasks/cancel'),
  CODEX_METHOD_GET_TASK: z.string().trim().default('tasks/get'),
  CODEX_METHOD_SUBMIT_DECISION: z.string().trim().default('tasks/decision'),
  CODEX_METHOD_SUBSCRIBE_TASK: z.string().trim().optional(),
  CODEX_NOTIFICATION_TASK_EVENT: z.string().trim().default('tasks/event'),
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
    methods: {
      listSessions: string;
      getSession: string;
      continueSession: string;
      cancelTask: string;
      getTask: string;
      submitDecision: string;
      subscribeTask?: string;
      taskEventNotification: string;
    };
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
      methods: {
        listSessions: parsed.CODEX_METHOD_LIST_SESSIONS,
        getSession: parsed.CODEX_METHOD_GET_SESSION,
        continueSession: parsed.CODEX_METHOD_CONTINUE_SESSION,
        cancelTask: parsed.CODEX_METHOD_CANCEL_TASK,
        getTask: parsed.CODEX_METHOD_GET_TASK,
        submitDecision: parsed.CODEX_METHOD_SUBMIT_DECISION,
        subscribeTask: parsed.CODEX_METHOD_SUBSCRIBE_TASK,
        taskEventNotification: parsed.CODEX_NOTIFICATION_TASK_EVENT,
      },
    },
    outputThrottleMs: parsed.OUTPUT_THROTTLE_MS,
  };
}
