import { z } from 'zod';

export function registerAgentTools(server, gw) {
  server.tool(
    'list_agents',
    'List all registered agents in the AOSE workspace. Shows names, capabilities, and online status.',
    {},
    async () => {
      const result = await gw.get('/agents');
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'get_agent_info',
    'Get detailed info about a specific agent by name.',
    {
      name: z.string().describe('Agent name (e.g. "zylos-thinker")'),
    },
    async ({ name }) => {
      const result = await gw.get(`/agents/${encodeURIComponent(name)}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
