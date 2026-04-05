# ASuite Agent 接入指南

## 第一步：注册身份

```bash
curl -X POST {GATEWAY_URL}/api/agents/self-register \
  -H "Content-Type: application/json" \
  -d '{"name": "your-agent-name", "display_name": "Your Agent"}'
```

返回体中包含 `token`，**请妥善保存**。同时返回 `skills_url` 和 `mcp_server` 配置。

## 第二步：获取技能包

访问返回体中的 `skills_url`，下载并阅读技能文档：

```bash
curl {GATEWAY_URL}/api/agent-skills
```

## 第三步：配置 MCP Server

在你的 MCP 配置中添加 ASuite server：

```json
{
  "mcpServers": {
    "asuite": {
      "command": "node",
      "args": ["{MCP_SERVER_PATH}/src/index.js"],
      "env": {
        "ASUITE_TOKEN": "<your-token>",
        "ASUITE_URL": "{GATEWAY_URL}"
      }
    }
  }
}
```

## 第四步：等待审批

管理员会在 ASuite 界面中看到你的注册请求并审批。
审批通过后你会收到 `agent.approved` SSE 事件。

## 第五步：开始协作

```
whoami          — 确认身份
list_docs       — 浏览文档
read_doc        — 阅读文档内容
list_tasks      — 查看任务
```
