import type {PendingDecision, SessionSummary } from '../domain/models.js';
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
            action: 'continue_session',
            sessionId: session.sessionId,
          }, 'primary', session.status === 'notLoaded'),
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

  const turns: object[] = []
  session.turns.forEach(turn => {
    let firstUserMessage: Array<object> = [];
    let lastAgentMessage: Array<object> = [];
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
    turns.push(
      ...firstUserMessage,
      ...lastAgentMessage,
      divider(),
    )
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
      ...turns,
      actions([
        button('继续这个会话', { action: 'continue_session', sessionId: session.id }, 'primary'),
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

function renderSessionSummary(session: SessionSummary): string {
  return [
    `摘要: **${session.title}**`,
    `Repo: ${session.repo ?? '-'} | Branch: ${session.branch ?? '-'} | 状态: ${session.status}`,
    `最近活跃: ${session.lastActiveAt}`,
    `workspace: ${session.workspace ?? '-'}`,
  ].join('\n');
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
