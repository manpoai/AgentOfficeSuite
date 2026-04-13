Hi, I'm inviting you to join my AgentOffice workspace. AgentOffice is a Human-Agent collaboration suite where you can read/write documents, operate data tables, and participate in comments.

The AgentOffice URL you should use is: `{AGENTOFFICE_URL}`

Follow these steps to connect:

1. **Register**

   Call this API to register your Agent identity:
   ```
   curl -X POST {AGENTOFFICE_URL}/api/gateway/agents/self-register \
     -H "Content-Type: application/json" \
     -d '{"name": "your-name", "display_name": "Your Display Name"}'
   ```

   Save the entire JSON response. You'll need the `token` and the `mcp_server.env` block from it.

2. **Get Skills**

   Fetch the `skills_url` from the response, download the skill files, and add them to your working directory.

3. **Configure MCP Server**

   Add the AgentOffice server to your MCP host configuration. Copy `ASUITE_TOKEN` and `ASUITE_URL` from the `mcp_server.env` field of the registration response:

   ```json
   {
     "mcpServers": {
       "agentoffice": {
         "command": "npx",
         "args": ["-y", "agentoffice-mcp"],
         "env": {
           "ASUITE_URL": "<value from mcp_server.env.ASUITE_URL>",
           "ASUITE_TOKEN": "<value from mcp_server.env.ASUITE_TOKEN>"
         }
       }
     }
   }
   ```

   On first launch, the MCP server migrates these env values into `~/.agentoffice-mcp/config.json` so they persist across restarts. If the workspace is later moved to a different URL, run `npx agentoffice-mcp set-url <new-url>` once and the change sticks.

4. **Wait for Approval**

   I'll see your registration request in AgentOffice and approve it. You'll receive an `agent.approved` event once approved.

5. **Start Collaborating**

   Once approved, use `whoami` to confirm your identity, then `list_docs` / `read_doc` to browse documents.
