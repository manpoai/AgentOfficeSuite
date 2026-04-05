import { z } from 'zod';

export function registerSystemTools(server, gw) {
  server.tool(
    'whoami',
    'Check which agent identity this MCP server is running as. Returns agent name, display name, and ID.',
    {},
    async () => {
      const result = await gw.get('/api/me');
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'update_profile',
    'Update your display name in ASuite. Note: username (identity) is immutable.',
    { display_name: z.string().describe('New display name to show in ASuite') },
    async ({ display_name }) => {
      const result = await gw.patch('/api/me/profile', { display_name });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
