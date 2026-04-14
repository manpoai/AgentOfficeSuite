import { z } from 'zod';

export function registerSystemTools(server, gw) {
  server.tool(
    'whoami',
    'Check which agent identity this MCP server is running as. Returns agent name, display name, and ID.',
    {},
    async () => {
      const result = await gw.get('/me');
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'update_profile',
    'Update your display name in AOSE. Note: username (identity) is immutable.',
    { display_name: z.string().describe('New display name to show in AOSE') },
    async ({ display_name }) => {
      const result = await gw.patch('/me/profile', { display_name });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
