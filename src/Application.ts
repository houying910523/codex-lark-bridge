import {LarkClient, LarkEvent} from "./lark/LarkClient.js";
import {CodexEvent, CodexGateway} from "./codex/CodexGateway.js";
import {Logger} from "pino";
import {AppConfig} from "./config.js";
import {EventDispatcher} from "./event/EventDispatcher.js";
import {CodexController} from "./codex/CodexController.js";
import {SessionService} from "./service/SessionService.js";
import {TaskService} from "./service/TaskService.js";


export class Application {
  private started = false;
  private readonly logger: Logger;
  private readonly lark: LarkClient;
  private readonly codex: CodexGateway;
  private readonly sessionService: SessionService;
  private readonly taskService: TaskService;

  constructor(
    config: AppConfig,
    logger: Logger,
  ) {
    this.logger = logger.child({ component: 'application' });
    const codexEventDispatcher = new EventDispatcher<CodexEvent>(logger.child({ component: 'codex-event-dispatcher' }));
    this.codex = new CodexGateway(config.codex, codexEventDispatcher, logger.child({ component: 'codex-gateway' }));
    const codexController = new CodexController(this.codex, logger.child({ component: 'codex-controller' }));

    const larkEventDispatcher = new EventDispatcher<LarkEvent>(logger.child({ component: 'lark-event-dispatcher' }));
    this.lark = new LarkClient(
      config.lark,
      larkEventDispatcher,
      logger.child({ component: 'lark-client' })
    );

    this.sessionService = new SessionService(
      codexController,
      this.lark,
      larkEventDispatcher,
      logger.child({ component: 'session-service' })
    );
    this.taskService = new TaskService(
      codexController,
      this.lark,
      larkEventDispatcher,
      logger.child({ component: 'task-service' })
    );
  }

  async start(): Promise<void> {
    await this.codex.connect();
    await this.lark.start();
    this.started = true;
  }

  async stop(): Promise<void> {
    await Promise.all([this.lark.stop(), this.codex.disconnect()]);
    this.started = false;
  }

  getReadiness(): {
    started: boolean;
    larkConnected: boolean;
    codexConnected: boolean;
  } {
    return {
      started: this.started,
      larkConnected: this.lark.isConnected(),
      codexConnected: this.codex.isConnected(),
    };
  }
}
