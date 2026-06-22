import type { CodexGateway } from './CodexGateway.js';
import {Logger} from "pino";
import {Thread, Turn} from "./protocol/v2";
import {AppConfig} from "../config";

export class CodexController {
  constructor(
    private readonly config: AppConfig['controller'],
    private readonly gateway: CodexGateway,
    private readonly logger: Logger
  ) {}

  async listSessions(): Promise<Thread[]> {
    const result: { data: Thread[] } = await this.gateway.send('thread/list', {});
    return result.data;
  }

  async getSession(sessionId: string): Promise<Thread> {
    const result: { thread: Thread } = await this.gateway.send('thread/read', {
      threadId: sessionId,
      includeTurns: true,
    });
    const thread = result.thread;
    thread.turns = thread.turns.filter(turn => turn.status === 'completed')
      .map(turn => {
        turn.items = turn.items.filter(item => ['agentMessage', 'userMessage'].includes(item.type))
        return turn
      })
    return thread;
  }

  async resumeSession(sessionId: string): Promise<Thread> {
    const result: { thread: Thread } = await this.gateway.send('thread/resume', {
      threadId: sessionId,
    });
    return result.thread
  }

  async createSession(): Promise<Thread> {
    const result: { thread: Thread } = await this.gateway.send('thread/start', {
      cwd: this.config.cwd,
      source: this.config.source
    })
    return result.thread
  }

  async sendUserMessage(sessionId: string, message: string): Promise<Turn> {
    const result: { turn: Turn } = await this.gateway.send('turn/start', {
      threadId: sessionId,
      input: [
        {
          type: 'text',
          text: message,
        },
      ]
    });
    return result.turn
  }

  async responseApproval(requestId: number, response: Record<string, unknown>): Promise<void> {
    await this.gateway.sendRequest(requestId, undefined, undefined, response)
  }
}
