import net from 'net';
import WebSocket from 'ws';
import {Logger} from "pino";
import {EventDispatcher} from "../event/EventDispatcher.js";
import {CodexEvent, CodexGateway, CodexGatewayOptions} from "./CodexGateway";


export class CodexSocketFileGateway extends CodexGateway {

    constructor(
        options: CodexGatewayOptions,
        eventDispatcher: EventDispatcher<CodexEvent>,
        logger: Logger,
    ) {
        super(options, eventDispatcher, logger)
    }

    protected createWebSocket(): WebSocket {
        if (!this.options.socketFile) {
            throw new Error('missing socketFile property')
        }
        const socketFile = this.options.socketFile;
        this.logger.info({ socketFile }, 'Connecting to Codex Unix socket');

        return new WebSocket('ws://localhost/', {
            handshakeTimeout: this.options.handshakeTimeoutMs ?? 10_000,
            perMessageDeflate: false,
            createConnection: () => net.createConnection(socketFile),
        });
    }
}
