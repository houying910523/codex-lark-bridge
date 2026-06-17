import WebSocket from 'ws';
import {Logger} from "pino";
import {EventDispatcher, XEvent} from "../event/EventDispatcher.js";
import {CodexProtocolError} from "../codex.js";

export interface CodexGatewayOptions {
  wsUrl: string;
  handshakeTimeoutMs?: number;
  reconnectMs?: number;
}

export interface CodexEvent extends XEvent {
  method: string;
  data: Record<string, unknown>;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  id: number;
  method: string;
  timeout: NodeJS.Timeout;
}
export class CodexGatewayError extends Error {}

export class CodexGateway {
  private ws?: WebSocket;
  private nextId = 1;
  private connected = false;
  private intentionallyClosed = false;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private connectPromise?: Promise<void>;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(
    private readonly options: CodexGatewayOptions,
    private readonly eventDispatcher: EventDispatcher<CodexEvent>,
    private readonly logger: Logger,
  ) {
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.intentionallyClosed = false;
    this.openSocket().then(ws => {
      this.ws = ws;
      this.send("initialize", {
        "clientInfo": {
          "name": "codex_vscode",
          "title": "Codex VS Code Extension",
          "version": "0.1.0"
        }
      })
    })
  }

  async disconnect(): Promise<void> {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (!this.ws) {
      this.connected = false;
      return;
    }

    const ws = this.ws;
    this.ws = undefined;

    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close();
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async send<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new CodexGatewayError('Codex WebSocket is not connected');
    }

    const id = this.nextId++;

    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: id,
      method: method,
      params: params,
    })

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new CodexProtocolError(`Codex request timed out: ${method}`));
      }, 20_000);

      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        id,
        method,
        timeout,
      });

      ws.send(payload, (error?: Error) => {
        if (!error) {
          // this.logger.info(payload)
          return;
        }
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      });
    });
  }

  async onMessage(message: string): Promise<void> {
    const payload = JSON.parse(message);
    const id: number = payload.id
    const pending = this.pendingRequests.get(id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(id);
    // await this.eventDispatcher.publish({
    //   source: 'codex-gateway',
    //   method: pending.method,
    //   data: payload,
    // });
    console.log(payload.result)
    pending.resolve(payload.result)
  }

  private openSocket(): Promise<WebSocket> {
    return new Promise<WebSocket>( (resolve, reject) => {
      this.logger.info({ wsUrl: this.options.wsUrl }, 'Connecting to Codex WebSocket');

      const ws = new WebSocket(this.options.wsUrl, {
        handshakeTimeout: this.options.handshakeTimeoutMs ?? 10_000,
      });

      ws.on('open', () => {
        this.logger.info('Connected to Codex WebSocket');
        this.connected = true;
        resolve(ws);
      });

      ws.on('message', (payload) => {
        this.onMessage(this.toMessageString(payload)).then(r => {});
      });

      ws.on('error', (error) => {
        this.logger.error({
          error,
        }, 'Codex WebSocket error');
      });

      ws.on('close', () => {
        this.connected = false;
        this.logger.warn('Codex WebSocket closed');
        if (!this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      });
      return ws
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionallyClosed) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch((error) => {
        this.logger.error({
          error,
        }, 'Failed to reconnect Codex WebSocket');
        this.scheduleReconnect();
      });
    }, this.options.reconnectMs ?? 3_000);
  }

  private toMessageString(payload: WebSocket.RawData): string {
    if (payload instanceof ArrayBuffer) {
      return Buffer.from(payload).toString('utf8');
    }

    if (Array.isArray(payload)) {
      return Buffer.concat(payload).toString('utf8');
    }

    return payload.toString('utf8');
  }
}
