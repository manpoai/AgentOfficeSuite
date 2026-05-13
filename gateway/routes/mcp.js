/**
 * MCP Streamable HTTP endpoint for connector agents (Claude.ai, ChatGPT, etc.)
 *
 * Exposes the full AOSE MCP tool surface over HTTP so external MCP clients
 * can call tools without running a local aose-mcp process.
 */

import jwt from 'jsonwebtoken';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildAoseMcpServer } from '../../mcp-server/src/build-server.js';

export default function mcpRoutes(app, shared) {
  const { db, hashToken } = shared;
  const GATEWAY_BASE = `http://localhost:${process.env.GATEWAY_PORT || 4000}/api`;

  function resolveAgent(req) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.slice(7);

    // Try JWT (OAuth mcp_access token or internal agent JWT)
    try {
      const decoded = jwt.verify(token, shared.JWT_SECRET, { algorithms: ['HS256'] });
      const agentId = decoded.agent_id || decoded.actor_id;
      if (agentId) {
        const agent = db.prepare(
          "SELECT id, deleted_at FROM actors WHERE id = ? AND type = 'agent'"
        ).get(agentId);
        if (agent && !agent.deleted_at) {
          db.prepare('UPDATE actors SET last_seen_at = ?, online = 1 WHERE id = ?').run(Date.now(), agent.id);
          return agent;
        }
      }
    } catch {
      // Not a valid JWT — try raw agent token
    }

    // Fall back to raw agent token (for direct testing / curl)
    const hash = hashToken(token);
    const agent = db.prepare(
      "SELECT id, deleted_at FROM actors WHERE token_hash = ? AND type = 'agent'"
    ).get(hash);
    if (agent && !agent.deleted_at) {
      db.prepare('UPDATE actors SET last_seen_at = ?, online = 1 WHERE id = ?').run(Date.now(), agent.id);
      return agent;
    }

    return null;
  }

  async function handleMcp(req, res) {
    const agent = resolveAgent(req);
    if (!agent) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${req.protocol}://${req.get('host')}/.well-known/oauth-protected-resource"`,
      });
      return res.end(JSON.stringify({ error: 'unauthorized' }));
    }

    // Create a short-lived internal JWT so GatewayClient can authenticate
    // against the same Gateway. The auth middleware accepts any JWT with a
    // valid actor_id.
    const internalToken = jwt.sign(
      { actor_id: agent.id, type: 'agent' },
      shared.JWT_SECRET,
      { expiresIn: '5m' },
    );

    const { server } = buildAoseMcpServer({
      baseUrl: GATEWAY_BASE,
      token: internalToken,
      name: 'aose-connector',
      version: '1.0.0',
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);

    try {
      await transport.handleRequest(req, res, req.body);
    } finally {
      await transport.close();
      await server.close();
    }
  }

  app.post('/mcp', handleMcp);
  app.get('/mcp', handleMcp);
  app.delete('/mcp', handleMcp);
}
