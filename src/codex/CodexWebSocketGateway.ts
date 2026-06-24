import WebSocket from 'ws';
import {CodexEvent, CodexGateway, CodexGatewayOptions} from "./CodexGateway";
import {EventDispatcher} from "../event/EventDispatcher";
import {Logger} from "pino";


export class CodexWebSocketGateway extends CodexGateway {

    constructor(
        options: CodexGatewayOptions,
        eventDispatcher: EventDispatcher<CodexEvent>,
        logger: Logger,
    ) {
        super(options, eventDispatcher, logger)
    }

    protected createWebSocket(): WebSocket {
        if (!this.options.wsUrl) {
            throw new Error('missing wsUrl property')
        }
        const wsUrl = this.options.wsUrl;
        this.logger.info({ wsUrl }, 'Connecting to Codex WebSocket');
        return new WebSocket(wsUrl, {
            handshakeTimeout: this.options.handshakeTimeoutMs ?? 10_000,
        });
    }
}
