import {Logger} from "pino";

export interface XEvent {
  source: string;
}

export type EventHandler<T extends XEvent> = (event: T) => Promise<void> | void;

export class EventDispatcher<T extends XEvent> {
  private handlers = new Map<string, Set<EventHandler<T>>>();

  constructor(
    private readonly logger: Logger
  ) {
  }

  registerHandler(source: string, handler: EventHandler<T>): () => void {
    const handlers = this.handlers.get(source) ?? new Set<EventHandler<T>>();
    handlers.add(handler);
    this.handlers.set(source, handlers);

    return () => {
      const registeredHandlers = this.handlers.get(source);
      if (!registeredHandlers) {
        return;
      }

      registeredHandlers.delete(handler);
      if (registeredHandlers.size === 0) {
        this.handlers.delete(source);
      }
    };
  }

  async publish(event: T): Promise<void> {
    const handlers = this.handlers.get(event.source);
    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(error);
        this.logger.error({ error, event, caller: handler.name }, "Event handler failed");
      }
    }
  }
}
