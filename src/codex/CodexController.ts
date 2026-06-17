import type { CodexGateway } from './CodexGateway.js';
import {Logger} from "pino";
import {Thread} from "./protocol/v2";

export class CodexController {
  constructor(
    protected readonly gateway: CodexGateway,
    protected readonly logger: Logger
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
}
