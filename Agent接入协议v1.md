# Agent 接入协议 v1

> 创建于 2026-03-20
> 基于 hxa-connect (github.com/coco-xyz/hxa-connect) 设计，针对 Human-Agent 协作办公套件裁剪与扩展。
> 本文档是拼凑版和正式开发阶段的设计锚点。阶段三完成后更新为 v1.1。

---

## 一、设计原则

1. **Human 和 Agent 是一等成员**
   Human 和 Agent 使用同一套成员 API，可以被 @、可以收任务、可以写文档。权限模型统一，不区分"人类专属"和"机器人专属"接口。

2. **协议层统一，底层映射各自系统**
   `/api/messages`、`/api/docs`、`/api/tasks` 是统一抽象。API Gateway 负责将操作路由到 Mattermost / Outline / Plane，Agent 无需感知底层系统差异。

3. **从 Zylos 接入场景倒推，不过度设计**
   协议 v1 只覆盖 Zylos 需要的最小操作集。新能力在 v1.1 追加，避免过早抽象。

4. **Webhook 主推，长轮询降级**
   有公网 Webhook URL 的 Agent 用推送；无公网地址的 Agent（如本地 Claude Code 进程）用 SSE 长轮询。

5. **借用 hxa-connect 成熟机制，不重复发明**
   注册流程、Catchup 机制、Webhook 签名方案直接采用 hxa-connect 设计。不采用 Thread/Artifact 模型（拼凑版阶段不需要，后续评估）。

---

## 二、采用 / 修改 / 丢弃清单（来自 hxa-connect）

| 组件 | 决策 | 说明 |
|---|---|---|
| 注册流程（invite→ticket→token）| **采用，简化** | 保留三步流程，去掉 join_approval（内部套件不需要审批） |
| Catchup 机制（`GET /me/catchup`）| **直接采用** | 完全一致，事件表 + 游标分页 |
| Webhook 签名（HMAC-SHA256）| **直接采用** | 签名格式：`sha256=hex(HMAC(secret, timestamp.body))`，5min 重放窗口 |
| Thread / Artifact 模型 | **暂不采用** | 拼凑版阶段不需要，协作粒度由 IM Thread / Outline Comment / Plane Issue 承担 |
| Bot 名称 tombstoning | **暂不采用** | v1 内部套件，成员稳定，不需要防止身份劫持 |
| WS ticket 间接鉴权 | **暂不采用** | v1 仅支持 Webhook + SSE 长轮询，不直接暴露 WS 给 Agent |
| 多租户 / org 隔离 | **暂不采用** | v1 单租户，一套部署服务 moonyaan 团队 |
| 乐观并发（revision + If-Match）| **暂不采用** | v1 单 Agent 场景，无并发冲突压力 |
| 消息 Parts 结构 | **简化采用** | v1 只支持 `text` 和 `markdown` 两种 part，后续扩展 |

---

## 三、Agent 注册 & 身份机制

### 3.1 注册流程（3 步）

```
Step 1 — 管理员创建 ticket
  POST /api/admin/tickets
  Headers: Authorization: Bearer <admin_token>
  Body: { label: "Zylos", expires_in: 86400 }   // TTL 秒，默认 24h
  Response: { ticket: "tkt_<32hex>", expires_at: <unix_ms> }

Step 2 — Agent 注册
  POST /api/auth/register
  Body:
  {
    ticket: "tkt_<32hex>",
    name: "zylos",              // 唯一，[a-zA-Z0-9_-]，全局唯一
    display_name: "Zylos",
    capabilities: ["write_doc", "run_code", "search_web"],  // 可选
    webhook_url: "https://zylos.example.com/webhook",       // 可选
    webhook_secret: "<random_32bytes_hex>"                  // 可选，有 webhook_url 时必填
  }
  Response:
  {
    agent_id: "agt_<16hex>",
    token: "<64hex>",           // 仅返回一次，请妥善保存
    name: "zylos",
    display_name: "Zylos",
    created_at: <unix_ms>
  }

Step 3 — 验证（可选）
  GET /api/me
  Headers: Authorization: Bearer <token>
  Response: { agent_id, name, display_name, capabilities, webhook_url, online, ... }
```

### 3.2 Token 机制

- Token 格式：64 位十六进制随机字符串（opaque token，不使用 JWT）
- 存储：DB 中存 `SHA-256(token)` hash，原文仅在注册时返回一次
- 使用：每次请求 `Authorization: Bearer <token>`
- 无过期（内部套件）；需要轮换时由管理员重置

### 3.3 身份表（`agent_accounts` 表）

```sql
CREATE TABLE agent_accounts (
  id          TEXT PRIMARY KEY,        -- "agt_<16hex>"
  name        TEXT UNIQUE NOT NULL,    -- 唯一标识，用于 @mention
  display_name TEXT NOT NULL,
  token_hash  TEXT NOT NULL,           -- SHA-256(token)
  capabilities TEXT,                   -- JSON array
  webhook_url TEXT,
  webhook_secret TEXT,                 -- 原文存储（用于签名验证），或加密存储
  online      BOOLEAN DEFAULT FALSE,
  last_seen_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

---

## 四、操作 API

API Gateway 基础路径：`/api`，所有请求需携带 `Authorization: Bearer <token>`。

### 4.1 发消息（IM）

```
POST /api/messages

Body:
{
  channel_id: string,      // Mattermost channel ID 或 "dm:<agent_name>"
  text: string,
  thread_id?: string       // Mattermost 原始 thread ID，回复时使用
}

Response 200:
{
  message_id: string,
  channel_id: string,
  created_at: number
}

错误码:
  400 INVALID_PAYLOAD     — 缺少必填字段
  401 UNAUTHORIZED        — token 无效
  404 CHANNEL_NOT_FOUND   — channel_id 不存在
  500 UPSTREAM_ERROR      — Mattermost 调用失败
```

### 4.2 写文档（Outline）

```
POST /api/docs
创建新文档

Body:
{
  title: string,
  content_markdown: string,
  collection_id?: string   // Outline collection ID，不填用默认
}

Response 201:
{
  doc_id: string,
  url: string,
  created_at: number
}

---

PATCH /api/docs/:doc_id
更新文档内容（全量替换，v1 不支持 diff）

Body:
{
  title?: string,
  content_markdown: string
}

Response 200:
{
  doc_id: string,
  updated_at: number
}

错误码:
  404 DOC_NOT_FOUND
  409 EDIT_CONFLICT       — 文档被锁定（Outline 编辑中），请稍后重试
```

### 4.3 回复评论（Outline）

```
POST /api/comments

Body:
{
  doc_id: string,
  text: string,
  parent_comment_id?: string   // 回复已有评论线程时使用
}

Response 201:
{
  comment_id: string,
  doc_id: string,
  created_at: number
}

错误码:
  404 DOC_NOT_FOUND / COMMENT_NOT_FOUND
```

### 4.4 更新任务状态（Plane）

```
PATCH /api/tasks/:task_id/status

Body:
{
  status: "todo" | "in_progress" | "done" | "cancelled"
}

Response 200:
{
  task_id: string,
  status: string,
  updated_at: number
}

错误码:
  404 TASK_NOT_FOUND
  422 INVALID_STATUS_TRANSITION
```

### 4.5 写任务评论（Plane）

```
POST /api/tasks/:task_id/comments

Body:
{
  text: string
}

Response 201:
{
  comment_id: string,
  task_id: string,
  created_at: number
}
```

### 4.6 创建子任务（Plane）

```
POST /api/tasks

Body:
{
  title: string,
  description?: string,
  assignee_name?: string,      // Agent name 或 Human name（通讯录 lookup）
  parent_task_id?: string,
  priority?: "urgent" | "high" | "medium" | "low" | "none"
}

Response 201:
{
  task_id: string,
  url: string,
  created_at: number
}
```

### 4.7 重放错过的事件（Catchup）

```
GET /api/me/catchup?since=<unix_ms>&cursor=<string>&limit=<number>

Response 200:
{
  events: CatchupEvent[],
  has_more: boolean,
  cursor?: string,
  next_url?: string   // 方便直接用于下一次请求
}

CatchupEvent:
{
  event_id: string,        // 幂等 ID，Agent 侧去重用
  type: string,            // 见第五节事件类型
  occurred_at: number,     // unix_ms
  data: object             // 同 Webhook payload 的 data 字段
}
```

---

## 五、Webhook 事件目录

### 5.1 统一 Envelope

所有推送给 Agent 的事件使用同一 envelope 格式：

```json
{
  "event": "message.mentioned",
  "source": "mattermost",
  "event_id": "evt_<16hex>",
  "timestamp": 1742400000000,
  "data": { ... }
}
```

字段说明：
- `event`：事件类型（见 5.2）
- `source`：来源系统（`mattermost` / `outline` / `plane` / `system`）
- `event_id`：全局唯一，用于 Catchup 重放幂等去重
- `timestamp`：unix_ms
- `data`：事件专属 payload

### 5.2 事件类型

#### `message.mentioned`（IM 中被 @）

```json
{
  "event": "message.mentioned",
  "source": "mattermost",
  "event_id": "evt_abc123",
  "timestamp": 1742400000000,
  "data": {
    "channel_id": "mm_channel_id",
    "channel_name": "general",
    "message_id": "mm_message_id",
    "thread_id": "mm_thread_id",       // 不为空时，消息在 Thread 内
    "text": "@zylos 帮我整理这个需求",
    "text_without_mention": "帮我整理这个需求",
    "sender": {
      "id": "mm_user_id",
      "name": "moonyaan",
      "type": "human"
    },
    "context": {
      "thread_history": [              // 最近 10 条 Thread 消息，提供上下文
        { "sender": "moonyaan", "text": "...", "timestamp": 1742399990000 }
      ]
    }
  }
}
```

#### `comment.mentioned`（文档评论中被 @）

```json
{
  "event": "comment.mentioned",
  "source": "outline",
  "event_id": "evt_def456",
  "timestamp": 1742400000000,
  "data": {
    "doc_id": "outline_doc_id",
    "doc_title": "需求文档 v2",
    "doc_url": "https://outline.example.com/doc/...",
    "comment_id": "outline_comment_id",
    "text": "@zylos 优化这段表达",
    "text_without_mention": "优化这段表达",
    "anchor_text": "原始被选中的文字段落内容",   // 用户选中的原文
    "sender": {
      "id": "outline_user_id",
      "name": "moonyaan",
      "type": "human"
    }
  }
}
```

#### `task.assigned`（任务被分配给 Agent）

```json
{
  "event": "task.assigned",
  "source": "plane",
  "event_id": "evt_ghi789",
  "timestamp": 1742400000000,
  "data": {
    "task_id": "plane_issue_id",
    "task_title": "整理用户反馈并生成报告",
    "task_description": "...",
    "task_url": "https://plane.example.com/...",
    "priority": "high",
    "status": "todo",
    "project_id": "plane_project_id",
    "project_name": "产品迭代",
    "assigned_by": {
      "id": "plane_user_id",
      "name": "moonyaan",
      "type": "human"
    }
  }
}
```

#### `task.commented`（Agent 负责的任务被评论）

```json
{
  "event": "task.commented",
  "source": "plane",
  "event_id": "evt_jkl012",
  "timestamp": 1742400000000,
  "data": {
    "task_id": "plane_issue_id",
    "task_title": "...",
    "comment_id": "plane_comment_id",
    "text": "这个任务需要先确认一下方向",
    "sender": {
      "id": "plane_user_id",
      "name": "moonyaan",
      "type": "human"
    }
  }
}
```

---

## 六、Webhook 签名与验证

### 6.1 请求 Headers

```
POST <agent_webhook_url>
Content-Type: application/json
X-Hub-Signature-256: sha256=<hex>
X-Hub-Timestamp: <unix_ms>
```

`Authorization: Bearer <webhook_secret>` 也会同时发送（向下兼容简单验证）。

### 6.2 签名计算

```
signed_payload = "<timestamp>.<json_body>"
signature = HMAC-SHA256(webhook_secret, signed_payload)
header = "sha256=" + hex(signature)
```

### 6.3 Agent 侧验证

```typescript
function verifyWebhook(secret: string, headers: Headers, rawBody: string): boolean {
  const timestamp = headers.get('X-Hub-Timestamp');
  const signature = headers.get('X-Hub-Signature-256');

  // 1. 检查时间戳新鲜度（5 分钟窗口）
  if (Date.now() - parseInt(timestamp) > 300_000) return false;

  // 2. 计算期望签名
  const expected = 'sha256=' + hmacSHA256(secret, `${timestamp}.${rawBody}`);

  // 3. 时序安全比较（防止时序攻击）
  return timingSafeEqual(signature, expected);
}
```

### 6.4 重试策略

套件向 Agent Webhook 投递失败时的重试：
- 立即重试 → 1 秒后 → 5 秒后 → 30 秒后（共 4 次）
- 每次请求超时：10 秒
- 连续 10 次失败 → Agent 标记为 `degraded`，暂停投递，事件进入 Catchup 队列
- Agent 重新上线后自动恢复

---

## 七、Catchup 机制

### 7.1 事件存储

```sql
CREATE TABLE events (
  id          TEXT PRIMARY KEY,        -- "evt_<16hex>"
  agent_id    TEXT NOT NULL,           -- 目标 Agent
  event_type  TEXT NOT NULL,
  source      TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,        -- unix_ms
  payload     TEXT NOT NULL,           -- JSON，完整 envelope
  delivered   BOOLEAN DEFAULT FALSE,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_events_agent_time ON events(agent_id, occurred_at);
```

保留时长：7 天（过期自动清理）。

### 7.2 重连流程

```
1. Agent 启动 / 重连
2. 记录断线前最后处理的 event_id 或 timestamp
3. GET /api/me/catchup?since=<last_timestamp>
4. 遍历所有分页（has_more 为 true 时继续）
5. 对每个 event，用 event_id 去重（Agent 侧维护已处理 ID 集合）
6. 处理完 Catchup 后，恢复正常 Webhook 接收
```

### 7.3 无公网地址的降级方案（SSE 长轮询）

Agent 无法提供 Webhook URL 时（如本地运行的 Claude Code 进程），使用 SSE：

```
GET /api/me/events/stream
Headers: Authorization: Bearer <token>
Accept: text/event-stream

Response（保持连接）:
data: {"event":"message.mentioned","source":"mattermost",...}\n\n
data: {"event":"task.assigned","source":"plane",...}\n\n
```

连接断开后，通过 Catchup API 补充中间错过的事件。

---

## 八、能力发现（Capability Registry）

### 8.1 标准能力标签

| 标签 | 含义 |
|---|---|
| `write_doc` | 创建/修改文档 |
| `run_code` | 执行代码（shell/python 等）|
| `search_web` | 搜索互联网 |
| `search_docs` | 检索知识库 |
| `send_message` | 发送 IM 消息 |
| `manage_task` | 创建/更新任务 |
| `analyze_data` | 数据分析 |
| `call_api` | 调用外部 API |

### 8.2 查询可用 Agent

```
GET /api/agents?capability=write_doc

Response 200:
{
  agents: [
    {
      agent_id: "agt_abc",
      name: "zylos",
      display_name: "Zylos",
      capabilities: ["write_doc", "run_code", "search_web"],
      online: true,
      last_seen_at: 1742400000000
    }
  ]
}
```

---

## 九、待定问题（留给阶段三修订）

1. **文档 patch 策略**：当前 v1 用全量替换（`content_markdown` 覆盖）。多人同时编辑时会有冲突。评估 Outline 的 OT/CRDT（Yjs）能否在 API 层暴露，或改用 append-only 的 ProseMirror patch 格式。

2. **长轮询 SSE 的背压**：大量事件时 SSE 流的背压处理机制，以及连接断开的自动重连策略（客户端实现）。

3. **跨 Agent 事件转发**：当 Agent A 触发的操作（如创建子任务）需要通知 Agent B 时，事件路由逻辑尚未定义。

4. **context 携带深度**：`message.mentioned` 的 `thread_history` 当前携带最近 10 条，是否足够？是否需要携带相关文档/任务链接？

5. **Human 成员 API**：Human 当前只作为事件的 `sender`，但 Human 自己是否需要通过同一套 API 操作套件（而非 Shell UI）？如果 API-first，Human 的 token 机制是什么？

6. **Webhook 的 SSRF 防护**：注册 Agent 时填写的 `webhook_url` 需要校验（拒绝内网 IP/域名），防止 SSRF 攻击内部服务。参考 hxa-connect 实现。

7. **多 Agent 协作场景**：多个 Agent 同时参与一个文档/任务时，如何通过协议层协调（避免互相覆盖）？v1 暂不处理，但需要在 v1.1 明确。

---

## 十、参考资料

- hxa-connect 源码：https://github.com/coco-xyz/hxa-connect
- Mattermost Bot Accounts：https://developers.mattermost.com/integrate/reference/bot-accounts/
- Outline REST API：https://www.getoutline.com/developers
- Plane Developer Docs：https://developers.plane.so/
