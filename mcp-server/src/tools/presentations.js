import { z } from 'zod';

export function registerPresentationTools(server, gw) {
  server.tool(
    'create_presentation',
    'Create a new presentation (slide deck). Returns the presentation_id.',
    {
      title: z.string().describe('Presentation title'),
    },
    async ({ title }) => {
      const result = await gw.post('/presentations', { title });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'get_presentation',
    'Read a presentation and all its slides. Returns the full data including slide elements, backgrounds, and notes.',
    {
      presentation_id: z.string().describe('Presentation ID'),
    },
    async ({ presentation_id }) => {
      const result = await gw.get(`/presentations/${presentation_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'add_slide',
    'Add a new slide to a presentation using a layout template or custom elements. Available layouts: "title" (big centered title), "title-content" (title + bullet points), "title-image" (title + image), "two-column" (title + two text columns), "blank" (empty slide).',
    {
      presentation_id: z.string().describe('Presentation ID'),
      layout: z.enum(['title', 'title-content', 'title-image', 'two-column', 'blank']).optional().describe('Slide layout template (omit for blank)'),
      title: z.string().optional().describe('Slide title text (for title/title-content/title-image/two-column layouts)'),
      bullets: z.array(z.string()).optional().describe('Bullet points (for title-content layout)'),
      left_content: z.string().optional().describe('Left column text (for two-column layout)'),
      right_content: z.string().optional().describe('Right column text (for two-column layout)'),
      image: z.string().optional().describe('Image URL (for title-image layout)'),
      background: z.string().optional().describe('Background color hex, e.g. "#ffffff"'),
      notes: z.string().optional().describe('Speaker notes for this slide'),
    },
    async ({ presentation_id, layout, title, bullets, left_content, right_content, image, background, notes }) => {
      const body = {};
      if (layout) body.layout = layout;
      if (title) body.title = title;
      if (bullets) body.bullets = bullets;
      if (left_content) body.left_content = left_content;
      if (right_content) body.right_content = right_content;
      if (image) body.image = image;
      if (background) body.background = background;
      if (notes) body.notes = notes;
      const result = await gw.post(`/presentations/${presentation_id}/slides`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'update_slide',
    'Update an existing slide by index. Can apply a new layout template or patch specific fields (background, notes, elements).',
    {
      presentation_id: z.string().describe('Presentation ID'),
      slide_index: z.number().int().min(0).describe('Zero-based slide index'),
      layout: z.enum(['title', 'title-content', 'title-image', 'two-column', 'blank']).optional().describe('Apply a layout template (replaces slide content)'),
      title: z.string().optional().describe('Slide title (used with layout, or updates title element directly)'),
      bullets: z.array(z.string()).optional().describe('Bullet points (for title-content layout)'),
      left_content: z.string().optional().describe('Left column text (for two-column layout)'),
      right_content: z.string().optional().describe('Right column text (for two-column layout)'),
      background: z.string().optional().describe('Background color hex, e.g. "#1a1a2e"'),
      notes: z.string().optional().describe('Speaker notes for this slide'),
    },
    async ({ presentation_id, slide_index, layout, title, bullets, left_content, right_content, background, notes }) => {
      const body = {};
      if (layout) body.layout = layout;
      if (title) body.title = title;
      if (bullets) body.bullets = bullets;
      if (left_content) body.left_content = left_content;
      if (right_content) body.right_content = right_content;
      if (background) body.background = background;
      if (notes) body.notes = notes;
      const result = await gw.patch(`/presentations/${presentation_id}/slides/${slide_index}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'delete_slide',
    'Delete a slide from a presentation by index. All subsequent slides shift left.',
    {
      presentation_id: z.string().describe('Presentation ID'),
      slide_index: z.number().int().min(0).describe('Zero-based slide index to delete'),
    },
    async ({ presentation_id, slide_index }) => {
      const result = await gw.del(`/presentations/${presentation_id}/slides/${slide_index}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
