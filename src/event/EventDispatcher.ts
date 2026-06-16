import {Logger} from "pino";

export interface XEvent {
  source: string;
}

export type EventHandler<T extends XEvent> = (event: T) => Promise<void> | void;

export class EventDispatcher<T extends XEvent> {
  private handlers = new Map<string, EventHandler<T>>();

  constructor(
    private readonly logger: Logger
  ) {
  }

  registerHandler(source: string, handler: EventHandler<T>): () => void {
    this.handlers.set(source, handler);

    return () => {
      this.handlers.delete(source);
    };
  }

  async publish(event: T): Promise<void> {
    const handler = this.handlers.get(event.source);

    if (!handler) {
      return;
    }

    try {
      await handler(event);
    } catch (error) {
      this.logger.info({
        error,
        event,
      }, "Event handler failed");
    }
  }
}
