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
  ItemStartedNotification, McpServerElicitationRequestParams,
  McpToolCall,
  ThreadItem,
  ThreadStartedNotification,
  ThreadStatusChangedNotification,
  TurnCompletedNotification, TurnPlanUpdatedNotification,
  TurnStartedNotification
} from "../codex/protocol/v2";
import {TaskState, TaskStore} from "../storage/TaskStore";
import {ParsedCommand} from "../domain/commands";
import {EventDispatcher} from "../event/EventDispatcher";
import {buildCommandExecution, buildMcpToolCallCard, buildTurnPlanCard, textCard} from "../lark/LarkCard";
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
    const messageId = data.message.message_id
    if (command?.kind === 'user_message') {
      const reaction_id = await this.lark.addEmoji(data.message.message_id, "Typing")
      taskState.turn = await this.codexController.sendUserMessage(taskState.currentSessionId, command.message)
      taskState.lark.messageId = messageId
      taskState.lark.reaction_id = {
        typing: reaction_id
      }
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
          if (taskState.session) {
            taskState.session.status = notification.status
          }
          await this.taskStore.write(taskState)
        },
        taskState.currentSessionId === notification.threadId
      )
      return
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
      return
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
      return
    }

    if (method === 'turn/completed') {
      const notification = data.params as TurnCompletedNotification
      await withCondition(
        async () => {
          taskState.turn = notification.turn
          taskState.activeItem = undefined
          await this.taskStore.write(taskState)
          await this.lark.deleteEmoji(taskState.lark.messageId, taskState.lark.reaction_id?.typing)
          await this.lark.addEmoji(taskState.lark.messageId, "DONE")
        },
        taskState.currentSessionId === notification.threadId,
        taskState.turn?.id === notification.turn.id,
      )
      return
    }

    if (method === 'item/started') {
      const notification = data.params as ItemStartedNotification
      await withCondition(
        async () => {
          taskState.activeItem = notification.item
          if (notification.item.type === 'agentMessage') {
            const messageId = await this.lark.sendCard(taskState.lark.chatId, textCard('思考中...'))
            taskState.streamState = {
              messageId: messageId,
              dirty: true
            }
            this.scheduleStreamMessageCardUpdate(taskState)
          }
          await this.taskStore.write(taskState)
        },
        taskState.currentSessionId === notification.threadId,
        taskState.turn?.id === notification.turnId,
      )
      return
    }

    if (method === 'item/agentMessage/delta') {
      const notification = data.params as AgentMessageDeltaNotification
      await withCondition(
        async () => {
          if (!notification.delta || taskState.activeItem?.type !== 'agentMessage') {
            return;
          }
          taskState.activeItem.text += notification.delta
          if (taskState.streamState) {
            taskState.streamState.dirty = true
          }
        },
        taskState.currentSessionId === notification.threadId,
        taskState.turn?.id === notification.turnId,
        taskState.activeItem?.id === notification.itemId
      )
      return
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
      return
    }

    if (method === 'turn/plan/updated') {
      const notification = data.params as TurnPlanUpdatedNotification
      await withCondition(
          async () => {
            await this.lark.sendCard(taskState.lark.chatId, buildTurnPlanCard(notification))
          },
          taskState.currentSessionId === notification.threadId,
          taskState.turn?.id === notification.turnId,
      )
      return
    }

    // 以下为request

    if (method === 'item/fileChange/requestApproval') {
      const request = data as ServerRequest
      // const fileChangeRequest = data.params as FileChangeRequestApprovalParams
      await this.codexController.responseApproval(request.id as number, {
        decision: "accept"
      })
    }

    if (method === 'mcpServer/elicitation/request') {
      const request = data as ServerRequest
      await this.codexController.responseApproval(request.id as number, {
        action: "accept"
      })
    }

    if (method === 'item/commandExecution/requestApproval') {
      const request = data as ServerRequest
      await this.codexController.responseApproval(request.id as number, {
        decision: "accept"
      })
    }

    if (method === 'error') {
      const notification = data.params as ErrorNotification
      await withCondition(
        async () => {
          await this.lark.sendText(taskState.lark.chatId, notification.error.message)
        },
        taskState.currentSessionId === notification.threadId,
        taskState.turn?.id === notification.turnId,
      )
    }
  }

  private scheduleStreamMessageCardUpdate(taskState: TaskState): void {
    const streamState = taskState.streamState
    if (!streamState) {
      return
    }

    streamState.timer = setTimeout(() => {
      if (taskState.activeItem?.type !== 'agentMessage') {
        return
      }
      if (!streamState.dirty) {
        return
      }
      this.logger.info('interval callback update card: ' + Date.now())
      this.lark.updateCard(streamState.messageId, textCard(taskState.activeItem?.text))
          .then(() => {
            streamState.timer = undefined
            streamState.dirty = false
            this.scheduleStreamMessageCardUpdate(taskState)
          })
    }, 1000)
  }

  async handleCompletedItem(taskState: TaskState, currentCompletedItem: ThreadItem) {
    switch (currentCompletedItem.type) {
      case 'agentMessage':
        const streamState = taskState.streamState || { messageId: '', timer: undefined }
        if (streamState.timer) {
          this.logger.info('clear update card interval callback')
          clearTimeout(streamState.timer)
        }
        await this.lark.updateCard(streamState.messageId, textCard(currentCompletedItem.text))
        break;
      case 'plan':
        if (currentCompletedItem.text) {
          await this.lark.sendCard(taskState.lark.chatId, textCard(currentCompletedItem.text))
        }
        break;
      case 'reasoning': {
        const content = [
          ...currentCompletedItem.summary,
          ...currentCompletedItem.content,
        ].join('\n')
        if (content) {
          await this.lark.sendText(taskState.lark.chatId, content)
        }
        break;
      }
      case 'mcpToolCall':
        await this.lark.sendCard(taskState.lark.chatId, buildMcpToolCallCard(currentCompletedItem))
        break;
      case 'commandExecution':
        await this.lark.sendCard(taskState.lark.chatId, buildCommandExecution(currentCompletedItem))
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

