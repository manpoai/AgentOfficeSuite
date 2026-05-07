import { z } from 'zod';

export function registerMessageTools(server, gw) {
  server.tool(
    'send_message',
    'Send a chat message back to the human user. Use this to reply in the direct message conversation.',
    {
      content: z.string().describe('Message text to send (supports markdown)'),
    },
    async ({ content }) => {
      const me = await gw.get('/me');
      const result = await gw.post(`/agents/${me.id}/messages`, { content });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
