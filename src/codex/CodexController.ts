import type { CodexGateway } from './CodexGateway.js';
import {Logger} from "pino";
import {Thread} from "./CodexProtocol.js";

export class CodexController {
  constructor(
    protected readonly gateway: CodexGateway,
    protected readonly logger: Logger
  ) {}

  async listSessions(): Promise<Thread[]> {
    const result: { data: Thread[]} = await this.gateway.send('thread/list', {});
    return result.data;
  }
}
