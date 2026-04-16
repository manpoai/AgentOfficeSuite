
![headerreadme](https://github.com/user-attachments/assets/d36e366f-0d23-432e-9dbb-7d912df5b60c)

[English](./README.md) | <u>中文</u> | [X 账号链接](https://x.com/manpoai)

# aose 是什么？

## 为你和 Agent 一起工作的办公套件

aose 把文档、数据表、幻灯片、流程图放进同一个工作空间。你可以让 Agent 创建文档、修改表格、整理演示稿、补充流程图，也可以自己继续编辑、写评论、查看历史版本、恢复内容。任务可以从你原本使用的聊天工具里发起，也可以直接在 aose 里通过评论和 `@agent` 继续推进。

在 aose 里，你和 Agent 都在处理同一份内容：一起创建、读取、修改、评论和追踪变化，所有过程都会留在系统里。**让人和 Agent 作为对等参与者，围绕同一份内容持续协作。不是在聊天窗口里一次次重新描述上下文，也不是在多个工具之间来回切换。**


---
![pic](https://github.com/user-attachments/assets/b5f079aa-2039-49a8-8f56-ffa02eb282b5)



## 快速开始

### 1. 启动本地 aose 工作空间

```bash
npx aose-main
```

这个 bootstrap 包会从 GitHub Release 下载 runtime artifact，初始化本地 aose 工作空间，并自动启动本地服务。

aose 是个本地服务，默认监听 `http://localhost:3000`（Shell）和 `http://localhost:4000`（Gateway）。推荐的部署方式是 **aose 和 Agent 跑在同一台机器上**，Agent 会通过 `http://localhost:4000` 直接连进来，零配置。

如果你想从另一台设备访问 aose，或者让 Agent 跑在另一台机器上，看下面 [自定义对外 URL](#自定义对外-url) 一节。

### 2. 日常使用（推荐）

日常使用建议把 aose 全局安装，这样可以用后台模式、状态查询和一键升级：

```bash
npm install -g aose-main
```

然后用下面这些命令管理服务：

```bash
aose start -d   # 后台启动
aose status     # 查看状态、版本、健康
aose stop       # 停止
aose restart    # 重启
aose logs -f    # 实时日志
aose update     # 下载最新 runtime 并重启
aose version    # 查看 bootstrap 和 runtime 版本
```

`npx aose-main` 和全局安装版共用同一个数据目录（`~/.aose/`），可以随时来回切换不会丢数据。Bootstrap 本身用 `npm install -g aose-main@latest` 升级，runtime 用 `aose update` 单独升级，两者刻意解耦。

---

## 自定义对外 URL

默认的同机器部署不需要任何配置。这一节只在你想换个地址访问 aose 的时候才会用到——比如你把 aose 跑在一台机器上，想让另一台机器上的 Agent 来连。

### 第 1 步 —— 把 aose 暴露到你选定的地址

自己起一个把你的 URL 转发到 `http://localhost:3000` 的方式：

- 一个 tunnel（Cloudflare Tunnel、ngrok、frp、tailscale-funnel、……），或者
- 一个反向代理（Caddy、nginx、……）+ 一个自定义域名

具体用哪种你自己定。aose 不内置任何一种。

### 第 2 步 —— 让 Agent 切到新地址

在跑 Agent 的机器上执行：

```bash
npx aose-mcp set-url https://your-domain.com/api/gateway
```

完。下次 Agent 的 MCP server 启动时就会用新地址。

查看当前设置：

```bash
npx aose-mcp show-config
```

### 你够不到的远程 Agent

绝大多数 Agent 跑在你能 `cd` 进去的机器上，第 2 步直接就能跑通。例外情况是 Agent 跑在你没有 shell 权限的远程机器上（云端 VM、别人的电脑、托管型 Agent 平台），这时候你没法自己跑 `set-url`。

这时候发一段消息让 Agent 在它自己那边跑：

```
我把 aose 切换到了新地址 <NEW_URL>。请在你的运行环境里跑一下：

  npx aose-mcp set-url <NEW_URL>

然后调一下 whoami 工具，确认新的连接正常。
```

如果连这一步都做不到，就只能直接改 Agent 宿主的 MCP 配置——每个平台改法不一样，一般是改 Agent 配置文件里的 `mcpServers` 段。


---

## 如何接入 Agent

| 步骤 | 阶段 | 说明 |
|---|---|---|
| 第 1 步 | Onboard | 在 aose 里复制 onboarding prompt，发送给 Agent，Agent 会发起注册申请 |
| 第 2 步 | 激活 | 在 aose 中审批 Agent 的注册申请 |
| 第 3 步 | 开始协作 | 你可以在原聊天平台给 Agent 下达任务，也可以直接在 aose 的评论中通过 `@agent` 发起协作 |

如果你之后把 aose 换到新地址，参考上面的 [自定义对外 URL](#自定义对外-url) 一节让 Agent 切过去。

支持接入的宿主型 Agent 平台会逐步扩展。当前包括：

- OpenClaw
- Zylos
- Claude Code
- Codex CLI
- Gemini CLI

---

## 协作如何发生

aose 里的协作，通常从两类入口开始。

### 1. 从原本的聊天工具发起

你可以继续在原来的聊天工具里给 Agent 交代任务，例如：

- 创建一份新文档
- 把会议纪要整理成结构化数据表
- 根据已有内容生成一版 Slides
- 按要求补一张流程图
- 修改某份文档中的部分内容

Agent 接到任务后，可以在 aose 中创建、读取和修改对应内容。完成之后，这些内容会继续留在 aose 里，供你和 Agent 后续查看、讨论、修改和恢复。

### 2. 从内容内部继续推进

当文档、数据表、Slides、Flowcharts 已经在系统里时，你也可以直接在内容对象内部继续协作，例如：

- 写评论
- `@agent`
- 提出修改请求
- 指定补充信息
- 针对某一段或某个对象继续讨论

这样后续协作会始终贴着内容本身发生，不需要把上下文搬来搬去。

---

## aose 适合你，如果你希望

- 让 Agent 直接创建、读取和修改真实内容，而不只是停留在聊天窗口里
- 用一个工作空间承载文档、数据表、幻灯片、流程图等内容
- 让协作贴着具体对象发生，而不是反复复制内容、转述上下文、再粘贴回去
- 让 Agent 的修改过程有记录、有版本、有恢复点
- 在引入 Agent 参与工作的同时，保留权限边界和人工干预能力


## 功能说明

### 文稿

富文本文档编辑器，支持你和 Agent 围绕同一份文档持续创建、编辑和讨论。

- 19 种内容块：段落、标题、无序列表、有序列表、任务列表、引用块、代码块（带语法高亮）、分割线、表格、图片、Mermaid 图、嵌入流程图、内容链接（ContentLink）等
- 9 种行内样式：粗体、斜体、删除线、代码、下划线、高亮、链接、上标、下标
- 支持嵌入其他文档和流程图的实时引用（ContentLink），内容可联动更新
- Agent 可通过 MCP 工具创建和编辑文档，编辑前自动保存版本快照

### 数据表

结构化数据表编辑器，支持多种字段类型、视图和表间关联。

- 20 种字段类型：文本、长文本、数字、单选、多选、日期、日期时间、复选框、URL、邮箱、手机号、评分、百分比、货币、自增编号、公式、关联（Link）、查找（Lookup）、附件、JSON
- 4 种视图：表格视图（Grid）、看板视图（Kanban）、画廊视图（Gallery）、表单视图（Form）
- 支持通过 Link 字段建立表间关系，通过 Lookup 字段引用关联表的值

### 演示文稿

演示文稿编辑器，支持创建、修改和评审幻灯片内容。

- 支持文本框、形状、图片、内嵌表格、流程图实时引用等元素
- 支持位置和尺寸、填充色、边框、字体样式、文本对齐、旋转、层级、透明度等属性控制
- 幻灯片中的文本框支持完整的富文本编辑
- 可导出为标准 PowerPoint 格式（PPTX）

### 流程图

流程图编辑器，基于节点-连线模型，支持复杂图形的绘制和协作。

- 24 种节点形状：矩形、圆角矩形、菱形、平行四边形、圆形、椭圆、六边形、星形、三角形、数据库图标、文档图标等
- 4 种连线样式：直线、正交折线、平滑曲线、圆角折线
- 支持设置箭头样式、线宽、颜色和标签文本
- 支持设置节点的填充色、边框色、字体、文本对齐和尺寸

### 评论

统一评论系统，所有内容类型共享同一套评论基础设施。

- 文档、数据表、幻灯片、流程图都使用同一套评论系统
- 评论可精准锚定到文档选区、图片、表格行、幻灯片元素、流程图节点或连线
- 通过 `@agent` 发起协作，被提及方会收到实时通知
- Agent 收到的事件会包含评论内容、锚点上下文和周围内容片段，方便直接理解上下文并执行操作

### 历史版本

版本历史和恢复能力，为 Agent 参与的工作流提供安全网。

- Agent 通过 MCP 编辑文档或数据表前，系统会自动创建版本快照
- 支持将任意内容恢复到历史版本
- 文档、数据表、幻灯片、流程图的版本历史统一管理

### Agent 管理

Agent 的身份和生命周期管理。

- Agent 可通过 onboarding prompt 自注册，并使用已配置的 aose 公网地址接入
- 注册申请需要经过审批后才能激活
- 每个 Agent 会标注所属平台，如 Zylos、OpenClaw、Claude Code、Codex CLI、Gemini CLI
- 支持显示 Agent 在线状态和最后活跃时间
- 管理员可重置 Agent 的 token

### 通知

实时通知系统。

- 你的内容收到新评论时会收到通知
- 你的评论被回复时会收到通知
- 你被 `@mention` 时会收到通知
- 有新的 Agent 注册时，管理员会收到通知

### 搜索

全局搜索，覆盖所有主要内容类型。

- 支持搜索文档标题和正文
- 支持全文检索（FTS5）
- 搜索结果会高亮匹配关键词

---

## Roadmap

- Tasks
- Project Management
- Messaging

---

## Contributing

欢迎贡献。

当前最适合参与的方式包括：
- 提交 bug 报告
- 改进文档
- 修复安装和自托管相关问题
- 改进 Agent 接入能力
- 修复编辑器可靠性问题

更多说明请查看 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## Community

- Discord(https://discord.gg/qF9ZMP4uzk)
- GitHub Issues — bugs and feature requests(https://github.com/yingcaishen/aose/issues)


## License

Agent Office 当前计划以 GNU AGPL v3.0 or later 作为首发开源协议。

See [LICENSE](./LICENSE).
