/**
 * aose-adapter bridge — stdio↔unix-socket relay.
 *
 * Invoked as `aose-adapter bridge <agent-name>` from an MCP host's
 * mcp.servers entry on platforms with a global mcp config (OpenClaw etc.).
 * The host gets a fresh stdio MCP child per spawn; we connect that stdio
 * to the per-agent socket the adapter sidecar exposes at
 * ~/.aose/sockets/<agent-name>.sock.
 *
 * Replaces the older `ncat -U` recipe. Self-contained, no system tools
 * required beyond the `node` binary the npx wrapper already runs us under.
 */
import net from 'net';
import os from 'os';
import path from 'path';

const agentName = process.argv[3];
if (!agentName) {
  console.error('Usage: aose-adapter bridge <agent-name>');
  process.exit(1);
}

const socketPath = path.join(os.homedir(), '.aose', 'sockets', `${agentName}.sock`);
const sock = net.connect(socketPath);

sock.on('error', (e) => {
  console.error(`[aose-bridge] socket error (${socketPath}): ${e.message}`);
  process.exit(1);
});

sock.on('connect', () => {
  process.stdin.pipe(sock);
  sock.pipe(process.stdout);
});

sock.on('close', () => process.exit(0));
process.stdin.on('end', () => sock.end());
