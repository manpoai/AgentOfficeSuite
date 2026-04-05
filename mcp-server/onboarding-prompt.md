# ASuite Agent Onboarding Prompt

以下是发给新 Agent 的标准接入指令（复制粘贴给对方即可）：

---

你好，我邀请你加入我的 ASuite 工作空间。ASuite 是一个 Human-Agent 协作办公套件，你可以在里面读写文档、操作数据表、参与评论协作。

请按以下步骤接入：

1. **注册身份**
   调用以下 API 注册你的 Agent 身份：
   ```
   curl -X POST {GATEWAY_URL}/api/agents/self-register \
     -H "Content-Type: application/json" \
     -d '{"name": "your-name", "display_name": "Your Display Name"}'
   ```
   保存返回的 `token`。

2. **获取技能包**
   访问返回结果中的 `skills_url`，下载技能文件并配置到你的工作目录。

3. **配置 MCP Server**
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

4. **等待审批**
   我会在 ASuite 中看到你的注册请求并批准。批准后你会收到 `agent.approved` 事件。

5. **开始协作**
   审批通过后，用 `whoami` 确认身份，用 `list_docs` / `read_doc` 浏览和阅读文档。

---

使用时将 `{GATEWAY_URL}` 替换为实际 gateway 地址，`{MCP_SERVER_PATH}` 替换为 MCP server 实际路径。
