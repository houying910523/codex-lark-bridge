# codex-lark-bridge

一个把飞书机器人私聊接到 Codex WebSocket 的桥接服务。

它负责做三件事：

- 从飞书接收用户私聊消息或卡片操作。
- 把消息路由到当前选中的 Codex 会话。
- 把 Codex 的文本输出、计划、工具调用和命令执行结果回推到飞书。

当前实现偏向最小闭环，重点是先把「飞书聊天 <-> Codex 会话」打通，而不是做完整的会话管理平台。

## 功能概览

- 支持飞书机器人私聊收消息。
- 支持列出 Codex 会话，并通过卡片恢复已有会话。
- 支持创建新会话，并把它保存为当前会话。
- 在已选中会话后，用户继续发送普通文本时，会转发给 Codex。
- 支持把以下 Codex 事件同步回飞书：
  - agent 文本消息
  - 计划内容
  - reasoning 文本
  - MCP 工具调用结果
  - 本地命令执行记录
- 提供 `GET /healthz` 和 `GET /readyz`。
- 使用本地 `task.json` 持久化当前 chat 与 session 绑定关系，服务重启后会尝试恢复。

## 当前限制

- 只支持飞书机器人私聊，群聊消息会直接提示不支持。
- 只处理飞书 `text` 和 `post` 两类消息。
- 当前真正打通的飞书命令只有：
  - `/codex`
  - `/codex sessions`
  - `/codex new`
- 发送普通文本前，必须先创建或选择一个会话。
- 代码里虽然已经解析 `/codex continue`、`/codex status`、`/codex stop`，但目前还没有完整接到飞书交互流程里，不建议写进使用手册当成已支持能力。

## 工作方式

```text
Feishu P2P message/card action
  -> LarkClient
  -> SessionService / TaskService
  -> CodexController
  -> CodexGateway (WebSocket JSON-RPC)
  -> Codex server

Codex notifications
  -> CodexGateway
  -> TaskService / SessionService
  -> LarkClient
  -> Feishu text/card reply
```

主要模块：

- `src/lark/LarkClient.ts`: 飞书长连接事件接收与消息发送。
- `src/codex/CodexGateway.ts`: Codex WebSocket 连接与请求/通知分发。
- `src/codex/CodexController.ts`: 对会话列表、会话创建、恢复、发消息做一层简单封装。
- `src/service/SessionService.ts`: 会话列表、恢复、详情卡片、重启恢复。
- `src/service/TaskService.ts`: 当前会话消息转发，以及 Codex 结果回推。
- `src/storage/TaskStore.ts`: 当前会话状态持久化。

## 环境要求

- Node.js 22+（建议使用支持 `--env-file-if-exists` 的版本）
- 一个可用的飞书自建应用，且已开启机器人与事件订阅
- 一个可访问的 Codex WebSocket 服务

## 安装

```bash
npm install
```

## 配置

项目通过环境变量读取配置。可以在仓库根目录放一个 `.env` 文件。

最小示例：

```dotenv
PORT=3100
LOG_LEVEL=info
DATA_DIR=.data

LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
# 可选。私有化部署或非默认域名时配置
# LARK_DOMAIN=

CODEX_WS_URL=ws://127.0.0.1:4501
CODEX_WS_HANDSHAKE_TIMEOUT_MS=10000
CODEX_WS_RECONNECT_MS=3000

# Codex turn 输出在桥接层的节流参数，当前代码已读取，后续可继续使用
OUTPUT_THROTTLE_MS=3000

# 可选。新会话默认工作目录
# CODEX_SESSION_CWD=/path/to/workspace
CODEX_SESSION_SOURCE=codex-lark-bridge
```

完整变量说明：

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `NODE_ENV` | 否 | `development` | 运行环境 |
| `PORT` | 否 | `3100` | HTTP 服务端口 |
| `LOG_LEVEL` | 否 | `info` | `pino` 日志级别 |
| `DATA_DIR` | 否 | `.data` | 本地状态持久化目录 |
| `LARK_APP_ID` | 是 | - | 飞书应用 App ID |
| `LARK_APP_SECRET` | 是 | - | 飞书应用 Secret |
| `LARK_DOMAIN` | 否 | - | 飞书开放平台域名，私有化场景使用 |
| `CODEX_WS_URL` | 是 | - | Codex WebSocket 地址，必须是 `ws://` 或 `wss://` |
| `CODEX_WS_HANDSHAKE_TIMEOUT_MS` | 否 | `10000` | WebSocket 握手超时 |
| `CODEX_WS_RECONNECT_MS` | 否 | `3000` | 断线重连间隔 |
| `OUTPUT_THROTTLE_MS` | 否 | `3000` | 预留的输出节流配置 |
| `CODEX_SESSION_CWD` | 否 | - | 创建新会话时传给 Codex 的工作目录 |
| `CODEX_SESSION_SOURCE` | 否 | `codex-lark-bridge` | 创建会话时附带的 source 标识 |

## 启动

开发模式：

```bash
npm run dev
```

构建：

```bash
npm run build
```

生产启动：

```bash
npm run start
```

类型检查与测试：

```bash
npm run typecheck
npm test
```

## 飞书侧接入说明

至少需要完成这些准备：

1. 创建飞书自建应用并启用机器人能力。
2. 给应用开通接收消息与发送消息相关权限。
3. 配置事件订阅，并确保服务端能够通过飞书 SDK 建立长连接。
4. 把机器人添加为可私聊使用。

这个项目当前通过飞书 SDK 的 WebSocket 客户端直接接收事件，不依赖你自己额外暴露飞书 webhook HTTP 地址。

## 使用方式

### 1. 查看可用会话

给机器人发送：

```text
/codex
```

或：

```text
/codex sessions
```

机器人会返回会话列表卡片，可以：

- 翻页
- 刷新
- 查看会话详情
- 继续指定会话

### 2. 创建新会话

给机器人发送：

```text
/codex new
```

创建成功后，当前私聊会绑定到这个 session。

### 3. 向当前会话继续提问

在已经创建或恢复会话之后，直接发送普通文本即可，例如：

```text
帮我修一下测试失败的问题
```

桥接服务会把这条消息作为 `turn/start` 的文本输入发给 Codex。

### 4. 查看执行结果

Codex 产生的内容会按类型回推到飞书：

- 普通文本回复：卡片
- 计划：卡片
- reasoning：文本消息
- MCP 调用：卡片，展示入参和结果
- 命令执行：卡片，展示命令内容

## HTTP 接口

### `GET /healthz`

用于进程存活探针，返回示例：

```json
{
  "ok": true,
  "uptime": 12.34
}
```

### `GET /readyz`

用于就绪探针。只有应用已启动、Lark 已连接、Codex 已连接时才会返回 `200`，否则返回 `503`。

返回示例：

```json
{
  "ok": true,
  "started": true,
  "larkConnected": true,
  "codexConnected": true
}
```

## 本地状态

当前会话状态会写到：

```text
<DATA_DIR>/task.json
```

里面主要保存：

- 当前飞书 chat ID
- 当前选中的 Codex session ID
- 最近一次 session / turn / item 状态

服务启动后，如果本地状态里存在 `currentSessionId`，会自动尝试恢复该会话。

## 目录结构

```text
src/
  app.ts
  config.ts
  server.ts
  codex/
  lark/
  service/
  storage/
  event/
test/
```

## 已知问题

- `LarkClient.start()` 当前没有把 `connected` 状态置为 `true`，这会影响 `/readyz` 的结果。
- `SessionService` 的帮助文案里写了 `/codex new <指令>`，但当前实现并不会读取这个额外参数。
- `OUTPUT_THROTTLE_MS` 已进入配置，但当前还没有在输出链路中实际使用。

这些问题不会影响 README 描述的主流程，但如果你准备把这个服务长期运行，建议优先修掉。
