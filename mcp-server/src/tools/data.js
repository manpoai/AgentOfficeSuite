import { z } from 'zod';

export function registerDataTools(server, gw) {
  server.tool(
    'list_tables',
    'List all database tables in the AOSE workspace. Returns table IDs and titles.',
    {},
    async () => {
      const result = await gw.get('/data/tables');
      // Simplify output: just id and title
      const tables = (result.list || []).map(t => ({ table_id: t.id, title: t.title }));
      return { content: [{ type: 'text', text: JSON.stringify({ tables }) }] };
    }
  );

  server.tool(
    'describe_table',
    'Get the schema of a database table — column names, types, and constraints. Use this before query_rows to understand what columns exist.',
    {
      table_id: z.string().describe('Table ID (from list_tables)'),
    },
    async ({ table_id }) => {
      const result = await gw.get(`/data/tables/${table_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'query_rows',
    'Query rows from a database table. Supports filtering with where clauses and sorting.',
    {
      table_id: z.string().describe('Table ID to query'),
      where: z.string().optional().describe('Filter expression, e.g. "(Status,eq,Active)" or "(Agent,eq,zylos-thinker)"'),
      sort: z.string().optional().describe('Sort expression, e.g. "-created_at" for descending'),
      limit: z.number().optional().default(25).describe('Max rows to return (default 25)'),
      offset: z.number().optional().default(0).describe('Skip first N rows (for pagination)'),
    },
    async ({ table_id, where, sort, limit, offset }) => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (where) params.set('where', where);
      if (sort) params.set('sort', sort);
      const result = await gw.get(`/data/${table_id}/rows?${params}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'insert_row',
    'Insert a new row into a database table. Pass column values as key-value pairs.',
    {
      table_id: z.string().describe('Table ID to insert into'),
      data: z.record(z.any()).describe('Row data as {column_title: value} object'),
    },
    async ({ table_id, data }) => {
      const result = await gw.post(`/data/${table_id}/rows`, data);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'update_row',
    'Update an existing row in a database table.',
    {
      table_id: z.string().describe('Table ID'),
      row_id: z.string().describe('Row ID to update'),
      data: z.record(z.any()).describe('Updated fields as {column_title: value} object'),
    },
    async ({ table_id, row_id, data }) => {
      const result = await gw.patch(`/data/${table_id}/rows/${row_id}`, data);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'delete_row',
    'Delete a row from a database table.',
    {
      table_id: z.string().describe('Table ID'),
      row_id: z.string().describe('Row ID to delete'),
    },
    async ({ table_id, row_id }) => {
      const result = await gw.del(`/data/${table_id}/rows/${row_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
