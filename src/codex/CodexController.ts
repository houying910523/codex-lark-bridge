import type { CodexGateway } from './CodexGateway.js';
import {Logger} from "pino";

export class CodexController {
  constructor(
    protected readonly gateway: CodexGateway,
    protected readonly logger: Logger
  ) {}
}
