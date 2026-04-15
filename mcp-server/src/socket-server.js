import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { buildAoseMcpServer } from './build-server.js';
import { SocketServerTransport } from './socket-transport.js';

/**
 * Start a unix-domain-socket MCP server bound to a single AOSE agent identity.
 *
 * Used by `aose-adapter` on OpenClaw-style hosts where the host platform's
 * MCP config is global rather than per-agent — the adapter sidecar already
 * holds the agent's AOSE token, so it doubles as the local MCP endpoint.
 * Each accepted connection gets its own McpServer instance + transport so
 * concurrent MCP host children (rare but possible) do not share state.
 *
 * The shell shim that the OpenClaw mcp host spawns (e.g. `ncat -U <path>`)
 * is responsible for stdio↔socket bridging; this server does not handle
 * stdio at all.
 *
 * Returns { close } so the caller can shut the listener down on SIGTERM.
 */
export async function startSocketMcpServer({ socketPath, baseUrl, token, logger = console }) {
  if (!socketPath) throw new Error('startSocketMcpServer: socketPath is required');
  if (!baseUrl) throw new Error('startSocketMcpServer: baseUrl is required');
  if (!token) throw new Error('startSocketMcpServer: token is required');

  // Ensure parent dir exists (e.g. ~/.aose/sockets/) and clear stale sock files
  // from prior crashed runs — bind() fails if the path exists.
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  try { fs.unlinkSync(socketPath); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const server = net.createServer((socket) => {
    const { server: mcp } = buildAoseMcpServer({ baseUrl, token });
    const transport = new SocketServerTransport(socket);
    mcp.connect(transport).catch((err) => {
      logger.error?.(`[aose-mcp-socket] connect failed: ${err.message}`);
      socket.destroy();
    });
    socket.on('error', (err) => {
      logger.error?.(`[aose-mcp-socket] socket error: ${err.message}`);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      // Restrict the socket to the owning user — the token forwarder must
      // not be readable by other local users.
      try { fs.chmodSync(socketPath, 0o600); } catch (e) {
        logger.warn?.(`[aose-mcp-socket] chmod 600 failed: ${e.message}`);
      }
      resolve();
    });
  });

  logger.log?.(`[aose-mcp-socket] listening on ${socketPath}`);

  const close = () => new Promise((resolve) => {
    server.close(() => {
      try { fs.unlinkSync(socketPath); } catch { /* ignore */ }
      resolve();
    });
  });

  return { close };
}
