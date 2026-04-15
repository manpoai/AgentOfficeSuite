import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from './gateway-client.js';
import { registerDocTools } from './tools/docs.js';
import { registerDataTools } from './tools/data.js';
import { registerSystemTools } from './tools/system.js';
import { registerAgentTools } from './tools/agents.js';
import { registerEventTools } from './tools/events.js';
import { registerCommentTools } from './tools/comments.js';
import { registerContentTools } from './tools/content.js';

/**
 * Build a fully-wired AOSE McpServer instance bound to the given base URL
 * and agent token. Caller is responsible for connecting it to a transport
 * (stdio for `aose-mcp` CLI, unix socket for the adapter MCP surface).
 *
 * `decorateHandler` (optional): a function (handler) → handler that wraps
 * every tool handler before it is registered with the McpServer. The stdio
 * CLI uses this to inject pending-event hints from its event bridge; the
 * unix-socket surface in the adapter doesn't need it (the adapter already
 * delivers events through its own SSE→deliver path).
 *
 * Returns { server, gw }.
 */
export function buildAoseMcpServer({ baseUrl, token, name = 'aose', version = '0.1.0', decorateHandler }) {
  const server = new McpServer(
    { name, version },
    { capabilities: { logging: {} } },
  );
  const gw = new GatewayClient(baseUrl, token);

  if (typeof decorateHandler === 'function') {
    const origTool = server.tool.bind(server);
    server.tool = (toolName, ...rest) => {
      const handler = rest[rest.length - 1];
      if (typeof handler !== 'function') return origTool(toolName, ...rest);
      rest[rest.length - 1] = decorateHandler(handler);
      return origTool(toolName, ...rest);
    };
  }

  registerDocTools(server, gw);
  registerDataTools(server, gw);
  registerSystemTools(server, gw);
  registerAgentTools(server, gw);
  registerEventTools(server, gw);
  registerCommentTools(server, gw);
  registerContentTools(server, gw);

  return { server, gw };
}
