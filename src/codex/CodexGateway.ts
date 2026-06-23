import WebSocket from 'ws';
import {Logger} from "pino";
import {EventDispatcher, XEvent} from "../event/EventDispatcher.js";

export class CodexProtocolError extends Error {}

export interface CodexGatewayOptions {
  wsUrl: string;
  handshakeTimeoutMs?: number;
  reconnectMs?: number;
}

export interface CodexEvent extends XEvent {
  method: string;
  data?: Record<string, any>;
}

type CodexRequest = {
  jsonrpc: string;
  id: number;
  params?: Record<string, unknown>;
  method?: string;
  result?: Record<string, any>;
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
      this.send("initialize", this.buildInitializeMessage()).then(() => {
        this.connected = true;
        this.eventDispatcher.publish({
          source: 'codex-gateway',
          method: 'initialized',
        })
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

  async sendRequest(id: number, method?: string, params?: Record<string, unknown>, result?: Record<string, any>): Promise<unknown> {
    const response: CodexRequest = {
      jsonrpc: '2.0',
      id: id,
    }
    if (method) {
      response.method = method;
    }
    if (params) {
      response.params = params;
    }
    if (result) {
      response.result = result;
    }
    const payload = JSON.stringify(response)
    return new Promise((resolve, reject) => {
      this.ws?.send(payload, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve(payload);
        }
      });
    })
  }

  async send<T = unknown>(method: string, params: Record<string, unknown>, responseId?: number): Promise<T> {
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new CodexGatewayError('Codex WebSocket is not connected');
    }
    const id = responseId ?? this.nextId++;

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
      this.sendRequest(id, method, params).catch(error => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      })
    });
  }

  async onMessage(message: string): Promise<void> {
    const payload = JSON.parse(message);
    const id: number = payload.id
    const pending = this.pendingRequests.get(id);
    if (pending) {
      pending.resolve(payload.result)
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(id);
    } else {
      this.logger.info({message: payload})
      await this.eventDispatcher.publish({
        source: 'codex-gateway',
        method: payload.method,
        data: payload,
      });
    }
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
        this.ws = undefined;
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

  private buildInitializeMessage(): Record<string, unknown> {
    return {
      "clientInfo": {
        "name": "codex_vscode",
        "title": "Codex VS Code Extension",
        "version": "0.1.0"
      },
      "capabilities": {
        "experimentalApi": true,
        "requestAttestation": false,
        "optOutNotificationMethods": [
          "thread/status/changed",
            "thread/started",
            "turn/started",
            "item/started",
            "item/completed",
            "item/agentMessage/delta",
            "item/fileChange/requestApproval",
          "item/plan/delta",
            "error",
        ]
      }
    }
  }
}
