import {CodexController} from "../codex/CodexController";
import {Logger} from "pino";
import {CodexEvent} from "../codex/CodexGateway";
import LarkClient, {LarkEvent} from "../lark/LarkClient";
import {
  type AgentMessageDeltaNotification,
  ErrorNotification,
  type FileChangeApprovalDecision,
  type FileChangeRequestApprovalParams,
  ItemCompletedNotification,
  ItemStartedNotification,
  McpToolCall,
  ThreadItem,
  ThreadStartedNotification,
  ThreadStatusChangedNotification,
  TurnCompletedNotification,
  TurnStartedNotification
} from "../codex/protocol/v2";
import {TaskState, TaskStore} from "../storage/TaskStore";
import {ParsedCommand} from "../domain/commands";
import {EventDispatcher} from "../event/EventDispatcher";
import {buildCommandExecution, buildMcpToolCallCard, textCard} from "../lark/LarkCard";
import {ServerRequest} from "../codex/protocol";

export class TaskService {
  constructor(
    private readonly codexController: CodexController,
    codexEventDispatcher: EventDispatcher<CodexEvent>,
    private readonly lark: LarkClient,
    larkEventDispatcher: EventDispatcher<LarkEvent>,
    private readonly taskStore: TaskStore,
    private readonly logger: Logger,
  ) {
    codexEventDispatcher.registerHandler('codex-gateway', event => this.onCodexEvent(event))
    larkEventDispatcher.registerHandler('lark', event => this.onLarkEvent(event))
  }

  async onLarkEvent(event: LarkEvent): Promise<void> {
    this.logger.info(event)
    const messageType = event.type

    if (messageType === 'message') {
      await this.onLarkMessage(event.payload.data, event.payload.command)
    }
  }

  async onLarkMessage(data: Record<string, any>, command?: ParsedCommand): Promise<void> {
    const taskState = await this.taskStore.read()
    if (!taskState.currentSessionId) {
      return;
    }
    if (command?.kind === 'user_message') {
      taskState.turn = await this.codexController.sendUserMessage(taskState.currentSessionId, command.message)
      await this.taskStore.write(taskState)
    }
  }

  async onCodexEvent(event: CodexEvent): Promise<void> {
    const { method, data } = event
    if (!data) {
      return;
    }
    const taskState = await this.taskStore.read()

    if (method === 'thread/status/changed') {
      const notification = data.params as ThreadStatusChangedNotification
      await withCondition(
        async () => {
          taskState.status = notification.status
          await this.taskStore.write(taskState)
        },
        taskState.currentSessionId === notification.threadId
      )
    }

    if (method === 'thread/started') {
      const notification = data.params as ThreadStartedNotification
      await withCondition(
        async () => {
          taskState.currentSessionId = notification.thread.id
          taskState.session = notification.thread
          await this.taskStore.write(taskState)
        },
        taskState.currentSessionId === notification.thread.id
      )
    }

    if (method === 'turn/started') {
      const notification = data.params as TurnStartedNotification
      await withCondition(
          async () => {
          taskState.turn = notification.turn
          await this.taskStore.write(taskState)
        },
        taskState.currentSessionId === notification.threadId,
      )
    }

    if (method === 'turn/completed') {
      const notification = data.params as TurnCompletedNotification
      await withCondition(
        async () => {
          taskState.turn = notification.turn
          await this.taskStore.write(taskState)
        },
        taskState.currentSessionId === notification.threadId,
        taskState.turn?.id === notification.turn.id,
      )
    }

    if (method === 'item/started') {
      const notification = data.params as ItemStartedNotification
      await withCondition(
        async () => {
          taskState.activeItem = notification.item
          await this.taskStore.write(taskState)
        },
        taskState.currentSessionId === notification.threadId,
        taskState.turn?.id === notification.turnId,
      )
    }

    if (method === 'item/agentMessage/delta') {
      const notification = data.params as AgentMessageDeltaNotification
      await withCondition(
        async () => {
          if (notification.delta && taskState.activeItem?.type === 'agentMessage') {
            taskState.activeItem.text += notification.delta
          }
        },
        taskState.currentSessionId === notification.threadId,
        taskState.turn?.id === notification.turnId,
        taskState.activeItem?.id === notification.itemId
      )
    }

    if (method === 'item/completed') {
      const notification = data.params as ItemCompletedNotification
      await withCondition(
        async () => {
          taskState.items ??= [];
          taskState.items.push(notification.item)
          await this.handleCompletedItem(taskState, notification.item)
        },
        taskState.currentSessionId === notification.threadId,
        taskState.turn?.id === notification.turnId,
        taskState.activeItem?.id === notification.item.id
      )
    }

    if (method === 'item/fileChange/requestApproval') {
      const request = data as ServerRequest
      // const fileChangeRequest = data.params as FileChangeRequestApprovalParams
      await this.codexController.responseApproval(request.id as number, {
        decision: "accept"
      })
    }

    if (method === 'error') {
      const notification = data.params as ErrorNotification
      await withCondition(
        async () => {
          await this.lark.sendText(taskState.larkChatId, notification.error.message)
        },
        taskState.currentSessionId === notification.threadId,
        taskState.turn?.id === notification.turnId,
      )
    }
  }

  async handleCompletedItem(taskState: TaskState, currentCompletedItem: ThreadItem) {
    switch (currentCompletedItem.type) {
      case 'agentMessage':
      case 'plan':
        if (currentCompletedItem.text) {
          await this.lark.sendCard(taskState.larkChatId, textCard(currentCompletedItem.text))
        }
        break;
      case 'reasoning': {
        const content = [
          ...currentCompletedItem.summary,
          ...currentCompletedItem.content,
        ].join('\n')
        if (content) {
          await this.lark.sendText(taskState.larkChatId, content)
        }
        break;
      }
      case 'mcpToolCall':
        await this.lark.sendCard(taskState.larkChatId, buildMcpToolCallCard(currentCompletedItem))
        break;
      case 'commandExecution':
        await this.lark.sendCard(taskState.larkChatId, buildCommandExecution(currentCompletedItem))
        break;
      default:
        break;
    }
  }
}


async function withCondition(callback: () => Promise<void>, ...conditions: boolean[]) {
  if (conditions.reduce((x, y) => x && y, true)) {
    await callback()
  }
}

