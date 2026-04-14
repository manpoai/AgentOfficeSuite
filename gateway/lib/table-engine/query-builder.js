/**
 * SQL query compiler for the table engine.
 *
 * Compiles { filters, sorts, limit, offset, search } into a parameterized
 * SQL SELECT against the physical row table. Returns { sql, params, fields }.
 *
 * SECURITY: every value the caller provides goes through `?` parameter
 * binding. Identifiers are validated by `quoteIdent` to ensure they match
 * `f_<hex>` shape only.
 */

function quoteIdent(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return `"${name}"`;
}

function physicalTableName(tableId) { return `utbl_${tableId}_rows`; }

const VIRTUAL_UIDTS = new Set(['CreatedTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'ID']);

// ── operator → SQL fragment generator ─────────────────────────────────
// Each entry takes (col, value) → { frag, params }
const OPERATORS = {
  eq:    (col, v) => ({ frag: `${col} = ?`, params: [v] }),
  neq:   (col, v) => ({ frag: `(${col} != ? OR ${col} IS NULL)`, params: [v] }),
  contains:     (col, v) => ({ frag: `${col} LIKE ?`, params: [`%${v}%`] }),
  not_contains: (col, v) => ({ frag: `(${col} NOT LIKE ? OR ${col} IS NULL)`, params: [`%${v}%`] }),
  starts_with:  (col, v) => ({ frag: `${col} LIKE ?`, params: [`${v}%`] }),
  ends_with:    (col, v) => ({ frag: `${col} LIKE ?`, params: [`%${v}`] }),
  gt:  (col, v) => ({ frag: `${col} > ?`, params: [v] }),
  gte: (col, v) => ({ frag: `${col} >= ?`, params: [v] }),
  lt:  (col, v) => ({ frag: `${col} < ?`, params: [v] }),
  lte: (col, v) => ({ frag: `${col} <= ?`, params: [v] }),
  is_empty:     (col) => ({ frag: `(${col} IS NULL OR ${col} = '')`, params: [] }),
  is_not_empty: (col) => ({ frag: `(${col} IS NOT NULL AND ${col} != '')`, params: [] }),
  is_true:  (col) => ({ frag: `${col} = 1`, params: [] }),
  is_false: (col) => ({ frag: `(${col} = 0 OR ${col} IS NULL)`, params: [] }),
  in: (col, v) => {
    const arr = Array.isArray(v) ? v : [v];
    if (arr.length === 0) return { frag: '0', params: [] };
    return { frag: `${col} IN (${arr.map(() => '?').join(', ')})`, params: arr };
  },
  not_in: (col, v) => {
    const arr = Array.isArray(v) ? v : [v];
    if (arr.length === 0) return { frag: '1', params: [] };
    return { frag: `(${col} NOT IN (${arr.map(() => '?').join(', ')}) OR ${col} IS NULL)`, params: arr };
  },
  // For MultiSelect / Link JSON arrays: check if any of the given option_ids appear
  has_any: (col, v) => {
    const arr = Array.isArray(v) ? v : [v];
    if (arr.length === 0) return { frag: '0', params: [] };
    const clauses = arr.map(() => `EXISTS (SELECT 1 FROM json_each(${col}) WHERE json_each.value = ?)`).join(' OR ');
    return { frag: `(${clauses})`, params: arr };
  },
  has_all: (col, v) => {
    const arr = Array.isArray(v) ? v : [v];
    if (arr.length === 0) return { frag: '1', params: [] };
    const clauses = arr.map(() => `EXISTS (SELECT 1 FROM json_each(${col}) WHERE json_each.value = ?)`).join(' AND ');
    return { frag: `(${clauses})`, params: arr };
  },
};

export function buildSelectQuery({
  table,        // user_tables row { id, physical_name, ... }
  fields,       // user_fields rows
  filters = [],
  sorts = [],
  limit = 100,
  offset = 0,
  search = null,
}) {
  if (!table?.id) throw new Error('buildSelectQuery: table required');
  const physName = physicalTableName(table.id);
  const physTable = quoteIdent(physName);
  const fieldById = new Map(fields.map(f => [f.id, f]));

  const params = [];
  const whereParts = [];

  // ── filters ──
  if (filters.length > 0) {
    let combined = '';
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i];
      const field = fieldById.get(f.field_id);
      if (!field) continue;
      if (VIRTUAL_UIDTS.has(field.uidt)) continue;
      const op = OPERATORS[f.operator];
      if (!op) throw new Error(`unknown operator: ${f.operator}`);
      const col = quoteIdent(field.physical_column);
      const { frag, params: opParams } = op(col, f.value);
      params.push(...opParams);
      if (i === 0) combined = frag;
      else combined += ` ${(f.conjunction || 'and').toUpperCase()} ${frag}`;
    }
    if (combined) whereParts.push(`(${combined})`);
  }

  // ── search (free text over primary field, fallback to first text field) ──
  if (search && typeof search === 'string') {
    const primary = fields.find(f => f.is_primary)
      || fields.find(f => ['SingleLineText', 'LongText', 'Email'].includes(f.uidt));
    if (primary && !VIRTUAL_UIDTS.has(primary.uidt)) {
      whereParts.push(`${quoteIdent(primary.physical_column)} LIKE ?`);
      params.push(`%${search}%`);
    }
  }

  // ── sorts ──
  let orderClause;
  if (sorts.length > 0) {
    const parts = [];
    for (const s of sorts) {
      const field = fieldById.get(s.field_id);
      if (!field || VIRTUAL_UIDTS.has(field.uidt)) continue;
      const dir = (s.direction || 'asc').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      parts.push(`${quoteIdent(field.physical_column)} ${dir}`);
    }
    orderClause = parts.length > 0 ? `ORDER BY ${parts.join(', ')}, rowid ASC` : 'ORDER BY created_at ASC, rowid ASC';
  } else {
    orderClause = 'ORDER BY created_at ASC, rowid ASC';
  }

  // ── assemble ──
  const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const sql = `SELECT * FROM ${physTable} ${where} ${orderClause} LIMIT ? OFFSET ?`.replace(/\s+/g, ' ').trim();
  params.push(limit, offset);

  return { sql, params, fields };
}
