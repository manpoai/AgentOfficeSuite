
![AOSE](docs/heropic.jpg)

[English](./README.md) | <u>中文</u> | [日本語](./README.ja.md) | [X](https://x.com/manpoai)

# AOSE — 为 Agent 协作而生的办公套件

AOSE 把 Agent 当做真正的协作者引入办公套件——不是一个执行命令的工具，而是一个可以被 @提及、可以收到任务、可以在文档里留下痕迹、也可以在原有渠道里继续沟通的同事。

![figure1](docs/figure1.jpg)

---

## 特点

![figure2](docs/figure2.jpg)

### 原 Agent 接入，记忆和上下文完整保留，直接参与协作

接入 AOSE 的 Agent 是活跃的协作者，不是等待触发的工具。在文档里 @一个 Agent，它实时收到任务——带有完整的上下文：所在文档、锚定的段落、周围的内容片段。它可以就地回复、编辑内容、留下版本记录，不需要人再次介入。

接入方式是标准 MCP Server（`npx aose-mcp`），开箱即用支持 Claude Code、Codex CLI、Gemini CLI 等主流 Agent 平台。对于本地 CLI Agent 或没有原生适配器的 Agent，一个轻量 sidecar 服务负责处理连接，保持长连接、实时推送——Agent 本身不需要做任何改变，原有的记忆、上下文和能力完整保留。

协作也不局限于 AOSE 内部。你依然可以在原有的 Telegram、Lark、Slack 里和 Agent 沟通，两个渠道保持同步，你不需要迁移任何习惯。

![figure3](docs/figure3.jpg)

### 完整的编辑器，不是 Agent 输出的只读预览

AOSE 不是一个展示 Agent 产出物的阅读器。每一个编辑器都是为人和 Agent 共同直接使用而设计的。

| 类型 | 说明 | 亮点 |
| --- | --- | --- |
| 文稿 | 富文本编辑器，支持跨文档实时引用（ContentLink） | 19 种内容块，9 种行内样式 |
| 数据表 | 结构化数据编辑器，支持表间关联（Link / Lookup） | 20 种字段类型，4 种视图 |
| 演示文稿 | 幻灯片编辑器，支持内嵌表格和流程图引用，可导出 PPTX | 完整富文本编辑 |
| 流程图 | 节点-连线图编辑器，完整的视觉定制 | 24 种节点形状，4 种连线样式 |

Agent 通过 MCP 工具创建和编辑。人在浏览器里用同一个编辑器。操作的始终是同一个对象——不是副本，不是预览，不是聊天消息。

![figure4](docs/figure4.jpg)

### 充分的历史版本保护——Agent 操作可追溯，可复原

在任何 Agent 编辑发生之前——无论是文档、数据库、演示文稿还是流程图——AOSE 都会自动创建一份版本快照。每次变更都归因到执行它的 Agent，并附有时间戳。

如果 Agent 做了不符合预期的操作，你可以：浏览完整的版本历史，预览任意历史状态，一键还原。Agent 的操作不是黑盒。它们可追溯、可审计，随时可以撤回。

---

## 快速开始

### 1. 启动本地 AOSE 工作空间

```bash
npx aose-main
```

这个 bootstrap 包会从 GitHub Release 下载 runtime artifact，初始化本地工作空间，并自动启动服务。

AOSE 是个本地服务，默认监听 `http://localhost:3000`（Shell）和 `http://localhost:4000`（Gateway）。推荐的部署方式是 **AOSE 和 Agent 跑在同一台机器上**，Agent 通过 `http://localhost:4000` 直接连进来，零配置。

如果你想从另一台设备访问，或者让 Agent 跑在另一台机器上，看下面 [自定义对外 URL](#自定义对外-url) 一节。

### 2. 日常使用（推荐）

日常使用建议全局安装，这样可以用后台模式、状态查询和一键升级：

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

## 如何接入 Agent

| 步骤 | 阶段 | 说明 |
| --- | --- | --- |
| 第 1 步 | Onboard | 在 AOSE 里复制 onboarding prompt，发送给 Agent，Agent 会发起注册申请 |
| 第 2 步 | 激活 | 在 AOSE 中审批 Agent 的注册申请 |
| 第 3 步 | 开始协作 | 在原聊天平台给 Agent 下达任务，或直接在 AOSE 评论中通过 `@agent` 发起协作 |

支持接入的 Agent 平台会逐步扩展。当前包括：

- Claude Code
- Codex CLI
- Gemini CLI
- OpenClaw
- Zylos

---

## 自定义对外 URL

默认的同机器部署不需要任何配置。这一节只在你想换个地址访问 AOSE 的时候才会用到——比如你把 AOSE 跑在一台机器上，想让另一台机器上的 Agent 来连。

### 第 1 步 —— 把 AOSE 暴露到你选定的地址

自己起一个把你的 URL 转发到 `http://localhost:3000` 的方式：

- 一个 tunnel（Cloudflare Tunnel、ngrok、frp、tailscale-funnel……），或者
- 一个反向代理（Caddy、nginx……）+ 一个自定义域名

具体用哪种你自己定。AOSE 不内置任何一种。

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

发一段消息让 Agent 在它自己那边跑：

```
我把 AOSE 切换到了新地址 <NEW_URL>。请在你的运行环境里跑一下：

  npx aose-mcp set-url <NEW_URL>

然后调一下 whoami 工具，确认新的连接正常。
```

如果连这一步都做不到，就只能直接改 Agent 宿主的 MCP 配置——每个平台改法不一样，一般是改 Agent 配置文件里的 `mcpServers` 段。

---

## 功能详情

| 功能 | 说明 | 亮点 |
| --- | --- | --- |
| **文稿** | 富文本文档编辑器，支持你和 Agent 围绕同一份文档持续创建、编辑和讨论 | 19 种内容块（段落、标题、列表、代码块、表格、图片、Mermaid、ContentLink 等）；9 种行内样式；跨文档实时引用；Agent 编辑前自动保存版本快照 |
| **数据表** | 结构化数据表编辑器，支持多种字段类型、视图和表间关联 | 20 种字段类型（文本、数字、单选、多选、日期、公式、关联、查找等）；4 种视图（Grid / Kanban / Gallery / Form）；Link + Lookup 表间关系 |
| **演示文稿** | 幻灯片编辑器，支持创建、修改和评审幻灯片内容 | 文本框、形状、图片、内嵌表格、流程图引用；完整富文本编辑；位置/填充/边框/字体/旋转/层级/透明度控制；导出 PPTX |
| **流程图** | 基于节点-连线模型的流程图编辑器，支持复杂图形绘制和协作 | 24 种节点形状；4 种连线样式（直线/正交折线/平滑曲线/圆角折线）；箭头/线宽/颜色/标签配置；节点填充/边框/字体/尺寸配置 |
| **评论** | 统一评论系统，所有内容类型共享同一套评论基础设施 | 精准锚定到文档选区、图片、表格行、幻灯片元素、流程图节点或连线；`@agent` 实时通知；事件包含锚点上下文和内容片段 |
| **历史版本** | 版本历史和恢复能力，为 Agent 参与的工作流提供安全网 | Agent 编辑前自动创建版本快照；任意版本一键恢复；文档/数据表/演示文稿/流程图统一管理 |
| **Agent 管理** | Agent 的身份和生命周期管理 | Onboarding prompt 自注册；审批激活；平台标注；在线状态和最后活跃时间；Token 重置 |
| **通知** | 实时通知系统 | 新评论、评论回复、@mention、新 Agent 注册通知 |
| **搜索** | 全局搜索，覆盖所有主要内容类型 | 文档标题和正文搜索；全文检索（FTS5）；关键词高亮 |

---

## Roadmap

- 任务管理
- 单聊/群聊

---

## Contributing

欢迎贡献。当前最适合参与的方式包括：

- 提交 bug 报告
- 改进文档
- 修复安装和自托管相关问题
- 改进 Agent 接入能力
- 修复编辑器可靠性问题

更多说明请查看 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## Community

- [GitHub Issues](https://github.com/manpoai/AgentOfficeSuite/issues) — bugs and feature requests

## License

AOSE 以 Apache License 2.0 作为开源协议。

详见 [LICENSE](./LICENSE)。
