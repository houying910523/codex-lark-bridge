import type { ContinueOptions, PendingDecision, SessionDetail, SessionSummary, TaskRecord } from '../domain/models.js';
import { formatDateTime, truncate } from '../domain/models.js';

const PRIMARY = 'blue';
const SUCCESS = 'green';
const DANGER = 'red';
const NEUTRAL = 'wathet';

export function buildSessionsCard(input: {
  sessions: SessionSummary[];
  page: number;
  pageSize: number;
}): object {
  const start = input.page * input.pageSize;
  const pageItems = input.sessions.slice(start, start + input.pageSize);
  const maxPage = Math.max(0, Math.ceil(input.sessions.length / input.pageSize) - 1);

  return card({
    title: '选择一个 Codex 会话',
    template: PRIMARY,
    elements: [
      markdown(`找到 **${input.sessions.length}** 个会话，按最近活跃时间倒序展示。`),
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
          page: Math.max(0, input.page - 1),
        }, undefined, input.page === 0),
        button('下一页', {
          action: 'page_sessions',
          page: Math.min(maxPage, input.page + 1),
        }, undefined, input.page >= maxPage),
        button('刷新', { action: 'refresh_sessions', page: input.page }),
      ]),
    ],
  });
}

export function buildSessionDetailCard(detail: SessionDetail): object {
  const recentMessages = detail.recentMessages.length > 0
    ? detail.recentMessages.map((message, index) => `${index + 1}. ${truncate(message, 140)}`).join('\n')
    : '暂无最近消息摘要';

  const recentFiles = detail.recentFiles.length > 0 ? detail.recentFiles.join(', ') : '暂无文件变更摘要';

  return card({
    title: `会话详情: ${detail.title}`,
    template: PRIMARY,
    elements: [
      markdown([
        `**Session ID**: \`${detail.sessionId}\``,
        `**Repo**: ${detail.repo ?? '-'}`,
        `**Branch**: ${detail.branch ?? '-'}`,
        `**Workspace**: ${detail.workspace ?? '-'}`,
        `**最近活跃**: ${detail.lastActiveAt}`,
        `**状态**: ${detail.status}`,
        `**最近摘要**: ${detail.lastSummary ?? '暂无'}`,
        `**最近任务**: ${detail.lastTaskSummary ?? '暂无'}`,
      ].join('\n')),
      markdown(`**最近消息**\n${recentMessages}`),
      markdown(`**最近文件**\n${recentFiles}`),
      actions([
        button('继续这个会话', { action: 'open_continue', sessionId: detail.sessionId }, 'primary'),
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
        `**Repo**: ${session.repo ?? '-'}`,
        `**Branch**: ${session.branch ?? '-'}`,
        `**最近摘要**: ${session.lastSummary ?? '暂无'}`,
        '',
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
    `**${session.title}**`,
    `Repo: ${session.repo ?? '-'} | Branch: ${session.branch ?? '-'} | 状态: ${session.status}`,
    `最近活跃: ${session.lastActiveAt}`,
    `摘要: ${session.lastSummary ?? '暂无'}`,
  ].join('\n');
}

function renderSummaryList(items: string[], title: string): string {
  const content = items.length > 0
    ? items.map((item) => `- ${truncate(item, 180)}`).join('\n')
    : '- 暂无';
  return `**${title}**\n${content}`;
}

function card(input: {
  title: string;
  template: string;
  elements: object[];
}): object {
  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: input.template,
      title: {
        tag: 'plain_text',
        content: input.title,
      },
    },
    elements: input.elements,
  };
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
