import {CodexController} from "../codex/CodexController.js";
import {Logger} from "pino";
import {EventDispatcher} from "../event/EventDispatcher.js";
import {CodexEvent} from "../codex/CodexGateway.js";
import {LarkClient, LarkEvent} from "../lark/LarkClient.js";

export class TaskService {
  constructor(
    private readonly codexController: CodexController,
    private readonly lark: LarkClient,
    private readonly larkEventDispatcher: EventDispatcher<LarkEvent>,
    private readonly logger: Logger,
  ) {
    larkEventDispatcher.registerHandler('lark', event => this.onLarkEvent(event))
  }

  async onLarkEvent(event: LarkEvent): Promise<void> {

  }

  async onCodexEvent(event: CodexEvent): Promise<void> {

  }
}
