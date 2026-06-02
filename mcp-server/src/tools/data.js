import { z } from 'zod';

export function registerDataTools(server, gw) {
  // ─── Table object-level tools ───────────────────────────────────────────────

  server.tool(
    'create_table',
    'Create a new database table with optional initial columns. Returns the table_id and created columns.',
    {
      title: z.string().describe('Table title'),
      columns: z.array(z.object({
        title: z.string().describe('Column name'),
        uidt: z.enum([
          'SingleLineText', 'LongText', 'Number', 'Decimal', 'Checkbox',
          'Date', 'DateTime', 'SingleSelect', 'MultiSelect',
          'PhoneNumber', 'Email', 'URL', 'Attachment',
        ]).optional().default('SingleLineText').describe('Column type'),
        options: z.array(z.string()).optional().describe('Options for SingleSelect/MultiSelect columns'),
      })).optional().default([]).describe('Initial columns (a row-id column is always auto-created)'),
      parent_id: z.string().optional().describe('Parent content item ID to nest under (omit for root level)'),
    },
    async ({ title, columns, parent_id }) => {
      const body = { title, columns };
      if (parent_id) body.parent_id = parent_id;
      const result = await gw.post('/data/tables', body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'update_table_meta',
    'Rename a database table.',
    {
      table_id: z.string().describe('Table ID to rename'),
      title: z.string().describe('New table title'),
    },
    async ({ table_id, title }) => {
      const result = await gw.patch(`/data/tables/${table_id}`, { title });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'delete_table',
    'Permanently delete a database table and all its rows. This cannot be undone.',
    {
      table_id: z.string().describe('Table ID to delete'),
    },
    async ({ table_id }) => {
      const result = await gw.del(`/data/tables/${table_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // ─── Column schema tools ─────────────────────────────────────────────────────

  server.tool(
    'add_column',
    'Add a new column to an existing table.',
    {
      table_id: z.string().describe('Table ID'),
      title: z.string().describe('Column name'),
      uidt: z.enum([
        'SingleLineText', 'LongText', 'Number', 'Decimal', 'Checkbox',
        'Date', 'DateTime', 'SingleSelect', 'MultiSelect',
        'PhoneNumber', 'Email', 'URL', 'Attachment',
      ]).optional().default('SingleLineText').describe('Column type'),
      options: z.array(z.string()).optional().describe('Options for SingleSelect/MultiSelect columns'),
    },
    async ({ table_id, title, uidt, options }) => {
      const body = { title, uidt };
      if (options) body.options = options;
      const result = await gw.post(`/data/tables/${table_id}/columns`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'update_column',
    'Rename a column or update its select options. Column type (uidt) cannot be changed — delete and recreate if needed.',
    {
      table_id: z.string().describe('Table ID'),
      column_id: z.string().describe('Column ID (from describe_table)'),
      title: z.string().optional().describe('New column name'),
      options: z.array(z.string()).optional().describe('New full options list for SingleSelect/MultiSelect (replaces existing)'),
    },
    async ({ table_id, column_id, title, options }) => {
      const body = {};
      if (title) body.title = title;
      if (options) body.options = options;
      const result = await gw.patch(`/data/tables/${table_id}/columns/${column_id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'delete_column',
    'Delete a column from a table. All data in that column will be lost.',
    {
      table_id: z.string().describe('Table ID'),
      column_id: z.string().describe('Column ID to delete (from describe_table)'),
    },
    async ({ table_id, column_id }) => {
      const result = await gw.del(`/data/tables/${table_id}/columns/${column_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // ─── Row-level tools ─────────────────────────────────────────────────────────

  server.tool(
    'reorder_columns',
    'Change the display order of columns in a table. Pass column IDs in the desired order. Use describe_table to get current column IDs.',
    {
      table_id: z.string().describe('Table ID'),
      column_order: z.array(z.string()).describe('Column IDs in the desired display order'),
    },
    async ({ table_id, column_order }) => {
      const result = await gw.patch(`/data/tables/${table_id}/columns/reorder`, { column_order });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

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
    'batch_insert_rows',
    'Insert multiple rows into a database table at once. More efficient than calling insert_row repeatedly. Maximum 500 rows per call.',
    {
      table_id: z.string().describe('Table ID to insert into'),
      rows: z.array(z.record(z.any())).min(1).max(500).describe('Array of row objects, each as {column_title: value}'),
    },
    async ({ table_id, rows }) => {
      const result = await gw.post(`/data/${table_id}/rows/batch`, { rows });
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
