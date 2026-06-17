import type {PendingDecision, SessionSummary, TaskRecord} from '../domain/models.js';
import {formatDateTime, truncate} from '../domain/models.js';
import {Thread} from "../codex/protocol/v2";

const PRIMARY = 'blue';
const SUCCESS = 'green';
const DANGER = 'red';
const NEUTRAL = 'wathet';

export type Card = {
  config: {
    update_multi: boolean,
    width_mode: 'default',
  }
  i18n_header: {
    zh_cn: {
      title: {
        tag: 'plain_text',
        content: string,
      },
      template: string,
    }
  },
  i18n_elements: {
    zh_cn: object[],
  },
}

function card(input: {
  title: string;
  template: string;
  elements: object[];
}): Card {
  return {
    config: {
      update_multi: true,
      width_mode: 'default',
    },
    i18n_header: {
      zh_cn: {
        title: {
          tag: 'plain_text',
          content: input.title,
        },
        template: input.template,
      }
    },
    i18n_elements: {
      zh_cn: input.elements,
    },
  };
}

export function buildSessionsCard(
  sessions: SessionSummary[],
  page: number,
  pageSize: number,
): object {
  const start = page * pageSize;
  const pageItems = sessions.slice(start, start + pageSize);
  pageItems.forEach(session => {
    console.log(session.title)
  })
  const maxPage = Math.max(0, Math.ceil(sessions.length / pageSize) - 1);

  return card({
    title: '选择一个 Codex 会话',
    template: PRIMARY,
    elements: [
      markdown(`找到 **${sessions.length}** 个会话，按最近活跃时间倒序展示。`),
      ...pageItems.flatMap((session) => [
        markdown(renderSessionSummary(session)),
        actions([
          button('继续', {
            action: 'open_continue',
            sessionId: session.sessionId,
          }, 'primary'),
          button('详情', {
            action: 'view_session_detail',
            sessionId: session.sessionId,
          }),
        ]),
        divider(),
      ]),
      actions([
        button('上一页', {
          action: 'page_sessions',
          page: Math.max(0, page - 1),
        }, undefined, page === 0),
        button('下一页', {
          action: 'page_sessions',
          page: Math.min(maxPage, page + 1),
        }, undefined, page >= maxPage),
        button('刷新', { action: 'refresh_sessions', page: page }),
      ]),
    ],
  });
}

export function buildSessionDetailCard(session: Thread, userId: string): object {
  let firstUserMessage: Array<object> = [];
  let lastAgentMessage: Array<object> = [];
  session.turns.forEach(turn => {
    turn.items.forEach(item => {
      if (item.type === 'agentMessage') {
        lastAgentMessage = [
          person('codex'),
          markdown(item.text || '')
        ]
      }
      if (item.type === 'userMessage' && !firstUserMessage.length) {
        firstUserMessage = [
          person(userId),
        ]
        item.content.forEach(ele => {
          if (ele.type === 'text') {
            firstUserMessage.push(
              markdown(ele.text || '')
            )
          }
        })
      }
    })
  })
  return card({
    title: `会话详情: ${session.preview.substring(0, Math.min(40, session.preview.length))}`,
    template: PRIMARY,
    elements: [
      markdown([
        `**Session ID**: \`${session.id}\``,
        `**Repo**: ${session.gitInfo?.originUrl ?? '-'}`,
        `**Branch**: ${session.gitInfo?.branch ?? '-'}`,
        `**Workspace**: ${session.cwd ?? '-'}`,
        `**最近活跃**: ${new Date(session.updatedAt * 1000).toLocaleString()}`,
        `**状态**: ${session.status.type}`,
      ].join('\n')),
      ...firstUserMessage,
      ...lastAgentMessage,
      actions([
        button('继续这个会话', { action: 'open_continue', sessionId: session.id }, 'primary'),
        button('返回列表', { action: 'refresh_sessions', page: 0 }),
      ]),
    ],
  });
}

export function buildContinueCard(session: SessionSummary): object {
  return card({
    title: `继续会话: ${session.title}`,
    template: PRIMARY,
    elements: [
      markdown([
        '填写下面的输入框后点击动作按钮。如果飞书卡片表单字段未成功回传，也可以直接发送：',
        `\`/codex continue <你的指令>\``,
      ].join('\n')),
      {
        tag: 'input',
        name: 'prompt',
        label: {
          tag: 'plain_text',
          content: '下一步指令',
        },
        required: true,
        multiline: true,
        placeholder: {
          tag: 'plain_text',
          content: '例如：请分析失败原因并给出修复方案',
        },
      },
      actions([
        button('开始执行', {
          action: 'submit_continue',
          sessionId: session.sessionId,
          options: {
            syncLatest: false,
            readOnly: false,
            planOnly: false,
          },
        }, 'primary'),
        button('只给建议', {
          action: 'submit_continue',
          sessionId: session.sessionId,
          options: {
            syncLatest: false,
            readOnly: true,
            planOnly: false,
          },
        }),
        button('先看计划', {
          action: 'submit_continue',
          sessionId: session.sessionId,
          options: {
            syncLatest: false,
            readOnly: false,
            planOnly: true,
          },
        }),
        button('返回列表', { action: 'refresh_sessions', page: 0 }),
      ]),
    ],
  });
}

export function buildRunningCard(task: TaskRecord): object {
  return card({
    title: `正在执行: ${task.sessionTitle ?? task.sessionId}`,
    template: NEUTRAL,
    elements: [
      markdown(renderTaskMeta(task)),
      markdown(renderSummaryList(task.summaries, '最近输出')),
      actions([
        button('刷新输出', { action: 'refresh_task', taskId: task.taskId }),
        button('停止执行', { action: 'stop_task', taskId: task.taskId }, 'danger'),
      ]),
    ],
  });
}

export function buildConfirmationCard(task: TaskRecord, decision: PendingDecision): object {
  return card({
    title: `等待确认: ${task.sessionTitle ?? task.sessionId}`,
    template: DANGER,
    elements: [
      markdown(renderTaskMeta(task)),
      markdown([
        `**确认项**: ${decision.title}`,
        decision.description ? `**说明**: ${decision.description}` : undefined,
        decision.expireAt ? `**超时**: ${formatDateTime(decision.expireAt)}` : undefined,
      ].filter(Boolean).join('\n')),
      actions(
        decision.options.map((option) =>
          button(option.label, {
            action: 'submit_decision',
            taskId: task.taskId,
            decisionToken: decision.decisionToken,
            option: option.value,
          }, option.value === decision.defaultOption ? 'primary' : undefined),
        ),
      ),
    ],
  });
}

export function buildTerminalCard(task: TaskRecord): object {
  const template = task.state === 'Succeeded' ? SUCCESS : task.state === 'Failed' ? DANGER : NEUTRAL;
  const summary = task.completionSummary ?? task.errorMessage ?? task.summaries.at(-1) ?? '暂无摘要';

  return card({
    title: `执行${terminalTitle(task.state)}: ${task.sessionTitle ?? task.sessionId}`,
    template,
    elements: [
      markdown(renderTaskMeta(task)),
      markdown(`**结果摘要**\n${summary}`),
      markdown(renderSummaryList(task.summaries, '最近摘要')),
      actions([
        button('继续追问', { action: 'open_continue', sessionId: task.sessionId }, 'primary'),
        button('返回列表', { action: 'refresh_sessions', page: 0 }),
      ]),
    ],
  });
}

export function buildStatusCard(task: TaskRecord): object {
  if (task.viewState === 'ConfirmationView') {
    return buildRunningCard(task);
  }

  if (task.viewState === 'SuccessView' || task.viewState === 'FailedView' || task.viewState === 'CancelledView') {
    return buildTerminalCard(task);
  }

  return buildRunningCard(task);
}

function terminalTitle(state: TaskRecord['state']): string {
  switch (state) {
    case 'Succeeded':
      return '完成';
    case 'Failed':
      return '失败';
    case 'Cancelled':
      return '已停止';
    default:
      return state;
  }
}

function renderTaskMeta(task: TaskRecord): string {
  return [
    `**Task ID**: \`${task.taskId}\``,
    `**会话**: ${task.sessionTitle ?? task.sessionId}`,
    `**Repo**: ${task.repo ?? '-'}`,
    `**Branch**: ${task.branch ?? '-'}`,
    `**状态**: ${task.state}`,
    `**阶段**: ${task.phase ?? '-'}`,
    `**开始时间**: ${formatDateTime(task.startedAt)}`,
    `**Prompt 摘要**: ${task.promptDigest}`,
  ].join('\n');
}

function renderSessionSummary(session: SessionSummary): string {
  return [
    `摘要: **${session.title}**`,
    `Repo: ${session.repo ?? '-'} | Branch: ${session.branch ?? '-'} | 状态: ${session.status}`,
    `最近活跃: ${session.lastActiveAt}`,
    `workspace: ${session.workspace ?? '-'}`,
  ].join('\n');
}

function renderSummaryList(items: string[], title: string): string {
  const content = items.length > 0
    ? items.map((item) => `- ${truncate(item, 180)}`).join('\n')
    : '- 暂无';
  return `**${title}**\n${content}`;
}

function person(name: string): object {
  return {
    "tag": "person",
    "size": "medium",
    "user_id": name
  }
}

function markdown(content: string): object {
  return {
    tag: 'markdown',
    content,
  };
}

function divider(): object {
  return { tag: 'hr' };
}

function actions(items: object[]): object {
  return {
    tag: 'action',
    actions: items,
  };
}

function button(
  label: string,
  value: Record<string, unknown>,
  type?: 'primary' | 'danger',
  disabled = false,
): object {
  return {
    tag: 'button',
    text: {
      tag: 'plain_text',
      content: label,
    },
    value,
    type,
    disabled,
  };
}
