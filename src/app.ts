import {LarkClient, LarkEvent} from "./lark/LarkClient";
import {CodexEvent, CodexGateway} from "./codex/CodexGateway";
import {Logger} from "pino";
import {AppConfig} from "./config";
import {EventDispatcher} from "./event/EventDispatcher";
import {CodexController} from "./codex/CodexController";
import {SessionService} from "./service/SessionService";
import {TaskService} from "./service/TaskService";
import {TaskStore} from "./storage/TaskStore";


export class App {
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
    this.codex = new CodexGateway(
      config.codex,
      codexEventDispatcher,
      logger.child({ component: 'codex-gateway' })
    );

    const codexController = new CodexController(
      config.controller,
      this.codex,
      logger.child({ component: 'codex-controller' })
    );

    const larkEventDispatcher = new EventDispatcher<LarkEvent>(logger.child({ component: 'lark-event-dispatcher' }));
    this.lark = new LarkClient(
      config.lark,
      larkEventDispatcher,
      logger.child({ component: 'lark-client' })
    );

    const taskStore = new TaskStore(config.dataDir)
    this.taskService = new TaskService(
      codexController,
      codexEventDispatcher,
      this.lark,
      larkEventDispatcher,
      taskStore,
      logger.child({ component: 'task-service' })
    );

    this.sessionService = new SessionService(
      codexController,
      codexEventDispatcher,
      this.lark,
      larkEventDispatcher,
      taskStore,
      logger.child({ component: 'session-service' })
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
