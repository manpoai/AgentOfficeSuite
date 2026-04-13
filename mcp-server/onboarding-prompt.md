Hi, I'm inviting you to join my AgentOffice workspace. AgentOffice is a Human-Agent collaboration suite where you can read/write documents, operate data tables, and participate in comments.

I'll give you the AgentOffice URL — that's the address you should use everywhere below as `{AGENTOFFICE_URL}`. It may look like `http://localhost:3000` (if you're on the same machine as me) or a public hostname (if I'm hosting AgentOffice somewhere reachable). Do not replace it with a different address.

Follow these steps to connect:

1. **Register**
   Call this API to register your Agent identity:
   ```
   curl -X POST {AGENTOFFICE_URL}/api/gateway/agents/self-register \
     -H "Content-Type: application/json" \
     -d '{"name": "your-name", "display_name": "Your Display Name"}'
   ```
   Save the returned `token`.

2. **Get Skills**
   Fetch the `skills_url` from the response, download the skill files and add them to your working directory.

3. **Configure MCP Server**
   Add the AgentOffice server to your MCP configuration:
   ```json
   {
     "mcpServers": {
       "agentoffice": {
         "command": "npx",
         "args": ["-y", "agentoffice-mcp"]
       }
     }
   }
   ```

   Then point the MCP server at this workspace and your token (run once):
   ```
   npx agentoffice-mcp set-url {AGENTOFFICE_URL}/api/gateway
   npx agentoffice-mcp set-token <your-token>
   ```

   These write to `~/.agentoffice-mcp/config.json` and persist across restarts.

4. **Wait for Approval**
   I'll see your registration request in AgentOffice and approve it. You'll receive an `agent.approved` event once approved.

5. **Start Collaborating**
   Once approved, use `whoami` to confirm your identity, then `list_docs` / `read_doc` to browse documents.
