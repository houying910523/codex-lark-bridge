import {CodexController} from "../codex/CodexController.js";
import {Logger} from "pino";
import {EventDispatcher} from "../event/EventDispatcher.js";
import {LarkClient, LarkEvent} from "../lark/LarkClient.js";
import {CodexEvent} from "../codex/CodexGateway.js";

export class SessionService {
  constructor(
    private readonly codexController: CodexController,
    private readonly codexEventDispatcher: EventDispatcher<CodexEvent>,
    private readonly lark: LarkClient,
    private readonly larkEventDispatcher: EventDispatcher<LarkEvent>,
    private readonly logger: Logger,
  ) {
    larkEventDispatcher.registerHandler('lark', this.onLarkEvent)
    codexEventDispatcher.registerHandler('codex-gateway', this.onCodexEvent)
  }

  async onLarkEvent(event: LarkEvent): Promise<void> {

  }

  async onCodexEvent(event: CodexEvent): Promise<void> {

  }
}
