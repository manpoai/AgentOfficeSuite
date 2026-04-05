/**
 * Baserow API adapter layer
 * Baserow REST API adapter layer
 * Keeps the same gateway-facing interface
 */

const BR_URL = process.env.BASEROW_URL || 'http://localhost:8280';
const BR_EMAIL = process.env.BASEROW_EMAIL;
const BR_PASSWORD = process.env.BASEROW_PASSWORD;
const BR_DATABASE_ID = process.env.BASEROW_DATABASE_ID;
const BR_TOKEN = process.env.BASEROW_TOKEN; // Database token for row operations

// ─── Auth ─────────────────────────────────────────
let brJwt = null;
let brJwtExpiry = 0;
let brRefreshToken = null;

/** Parse JWT payload to extract expiry timestamp. Falls back to 9 min from now. */
function getJwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (payload.exp) return payload.exp * 1000; // exp is in seconds
  } catch { /* ignore parse errors */ }
  return Date.now() + 9 * 60 * 1000; // fallback: 9 min
}

async function getBrJwt() {
  if (brJwt && Date.now() < brJwtExpiry - 60000) return brJwt;
  if (!BR_EMAIL || !BR_PASSWORD) return null;

  // Try refresh first
  if (brRefreshToken) {
    try {
      const res = await fetch(`${BR_URL}/api/user/token-refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: brRefreshToken }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.access_token) {
          brJwt = data.access_token;
          brRefreshToken = data.refresh_token || brRefreshToken;
          brJwtExpiry = getJwtExpiry(brJwt);
          return brJwt;
        }
      }
    } catch (refreshErr) {
      console.warn('[baserow] Token refresh failed, falling back to full login:', refreshErr.message);
    }
  }

  // Full login
  const res = await fetch(`${BR_URL}/api/user/token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: BR_EMAIL, password: BR_PASSWORD }),
  });
  const data = await res.json();
  if (data.access_token || data.token) {
    brJwt = data.access_token || data.token;
    brRefreshToken = data.refresh_token || null;
    brJwtExpiry = getJwtExpiry(brJwt);
    console.log('[baserow] JWT refreshed');
  }
  return brJwt;
}

// ─── Generic API call ─────────────────────────────
async function br(method, path, body, { useToken = false, rawResponse = false } = {}) {
  let authHeader;
  if (useToken && BR_TOKEN) {
    authHeader = `Token ${BR_TOKEN}`;
  } else {
    const jwt = await getBrJwt();
    if (!jwt) return { status: 503, data: { error: 'BASEROW_NOT_CONFIGURED' } };
    authHeader = `JWT ${jwt}`;
  }

  const url = `${BR_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
    signal: controller.signal,
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  try {
    const res = await fetch(url, opts);
    clearTimeout(timer);
    if (rawResponse) return res;
    const text = await res.text();
    try { return { status: res.status, data: JSON.parse(text) }; }
    catch { return { status: res.status, data: text }; }
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return { status: 504, data: { error: 'BASEROW_TIMEOUT' } };
    return { status: 502, data: { error: err.message } };
  }
}

// ─── Field type mapping ───────────────────────────
// Gateway uidt → Baserow field type
const UIDT_TO_BR = {
  'SingleLineText': 'text',
  'LongText': 'long_text',
  'Number': 'number',
  'Decimal': 'number',
  'Checkbox': 'boolean',
  'Date': 'date',
  'DateTime': 'date',
  'Email': 'email',
  'URL': 'url',
  'SingleSelect': 'single_select',
  'MultiSelect': 'multiple_select',
  'ID': 'autonumber',
  'AutoNumber': 'autonumber',
  'CreatedTime': 'created_on',
  'LastModifiedTime': 'last_modified',
  'CreatedBy': 'text',       // Baserow doesn't have CreatedBy — use text
  'LastModifiedBy': 'text',  // Baserow doesn't have LastModifiedBy — use text
  'Formula': 'formula',
  'LinkToAnotherRecord': 'link_row',
  'Links': 'link_row',
  'Lookup': 'lookup',
  'Rollup': 'rollup',
  'Attachment': 'file',
  'Rating': 'rating',
  'PhoneNumber': 'phone_number',
  'Percent': 'number',
  'Duration': 'duration',
  'Currency': 'number',
};

// Baserow field type → gateway uidt (for response mapping)
const BR_TO_UIDT = {
  'text': 'SingleLineText',
  'long_text': 'LongText',
  'number': 'Number',
  'boolean': 'Checkbox',
  'date': 'Date',
  'email': 'Email',
  'url': 'URL',
  'single_select': 'SingleSelect',
  'multiple_select': 'MultiSelect',
  'autonumber': 'AutoNumber',
  'created_on': 'CreatedTime',
  'last_modified': 'LastModifiedTime',
  'formula': 'Formula',
  'link_row': 'Links',
  'lookup': 'Lookup',
  'rollup': 'Rollup',
  'file': 'Attachment',
  'rating': 'Rating',
  'phone_number': 'PhoneNumber',
  'duration': 'Duration',
  'last_modified_by': 'LastModifiedBy',
  'created_by': 'CreatedBy',
  'uuid': 'SingleLineText',
  'auto_number': 'AutoNumber',
  'count': 'Number',
  'multiple_collaborators': 'User',
  'password': 'SingleLineText',
};

// ─── Where clause → Baserow filter params ─────────
// Where format: (field,op,value)~and(field2,op,value2)
// Baserow filter format: filter__field_{id}__{type}=value (query params)
function parseWhere(where) {
  if (!where) return [];
  const filters = [];
  // Split on ~and or ~or
  const parts = where.split(/~(and|or)/);
  for (const part of parts) {
    if (part === 'and' || part === 'or') continue;
    const match = part.match(/^\((.+?),(eq|neq|like|nlike|gt|gte|lt|lte|is|isnot|null|notnull|in|notin),(.*)?\)$/);
    if (match) {
      filters.push({ field: match[1], op: match[2], value: match[3] || '' });
    }
  }
  return filters;
}

// Map comparison operators to Baserow filter types
const OP_TO_BR = {
  'eq': 'equal',
  'neq': 'not_equal',
  'like': 'contains',
  'nlike': 'contains_not',
  'gt': 'higher_than',
  'gte': 'higher_than_or_equal',
  'lt': 'lower_than',
  'lte': 'lower_than_or_equal',
  'is': 'equal',
  'isnot': 'not_equal',
  'null': 'empty',
  'notnull': 'not_empty',
  'in': 'equal',       // 'in' = value is one of a list; mapped per-value below
  'notin': 'not_equal', // 'notin' = value is not in a list
};

// Baserow view type mapping
const BR_VIEW_TYPE_MAP = {
  'grid': 'grid',
  'gallery': 'gallery',
  'form': 'form',
  'kanban': 'kanban',
  'calendar': 'calendar',
};

// Baserow view type number → name (for response)
const BR_VIEW_TYPE_NUM = {
  'grid': 3,
  'gallery': 2,
  'form': 1,
  'kanban': 4,
  'calendar': 5,
};

// ─── Table metadata cache (field name→id mapping) ─
const tableFieldCache = new Map(); // tableId → { fields: [...], ts: number }
const CACHE_TTL = 60_000; // 1 minute

async function getTableFields(tableId) {
  const cached = tableFieldCache.get(String(tableId));
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.fields;
  const result = await br('GET', `/api/database/fields/table/${tableId}/`);
  if (result.status >= 400) return [];
  const fields = result.data || [];
  tableFieldCache.set(String(tableId), { fields, ts: Date.now() });
  return fields;
}

function invalidateFieldCache(tableId) {
  tableFieldCache.delete(String(tableId));
}

// Build field name→id map
async function getFieldMap(tableId) {
  const fields = await getTableFields(tableId);
  const map = {};
  for (const f of fields) {
    map[f.name] = f;
  }
  return map;
}

// ─── Row response normalization ───────────────────
// Normalize Baserow row data for gateway responses
// Baserow returns field names as keys (with user_field_names=true)
// Select fields: {id, value, color} → string value
// File fields: different attachment format normalization

function normalizeRowForGateway(row, fields) {
  const normalized = {};
  // Preserve the id as "Id" for gateway compat
  normalized.Id = row.id;
  // Preserve order if present
  if (row.order !== undefined) normalized.order = row.order;

  for (const field of fields) {
    const val = row[field.name];
    if (val === undefined) continue;

    if (field.type === 'single_select') {
      // Baserow: {id: 1, value: "Option", color: "blue"} or null
      normalized[field.name] = val ? val.value : null;
    } else if (field.type === 'multiple_select') {
      // Baserow: [{id: 1, value: "Option1"}, ...]
      normalized[field.name] = Array.isArray(val) ? val.map(v => v.value).join(',') : val;
    } else if (field.type === 'link_row') {
      // Baserow: [{id: 1, value: "display_value"}, ...]
      // Gateway normalizes link row values
      normalized[field.name] = val;
    } else if (field.type === 'file') {
      // Baserow: [{url, thumbnails, visible_name, name, size, mime_type, ...}]
      // Normalized: [{name (server), path, title (display), mimetype, size, url, thumbnails}]
      if (Array.isArray(val)) {
        normalized[field.name] = val.map(f => ({
          name: f.name,  // server filename — needed for round-trip updates
          path: f.url,
          title: f.visible_name || f.original_name || f.name,
          mimetype: f.mime_type,
          size: f.size,
          url: f.url,
          thumbnails: f.thumbnails,
        }));
      } else {
        normalized[field.name] = val;
      }
    } else if (field.type === 'boolean') {
      normalized[field.name] = val;
    } else if (field.type === 'created_on' || field.type === 'last_modified') {
      normalized[field.name] = val;
    } else {
      normalized[field.name] = val;
    }
  }
  return normalized;
}

// ─── Row data normalization for Baserow input ─────
// Convert gateway row data to Baserow format
function normalizeRowForBaserow(rowData, fields) {
  const normalized = {};
  for (const [key, val] of Object.entries(rowData)) {
    // Skip system fields
    if (key === 'Id' || key === 'id' || key === 'order') continue;

    const field = fields.find(f => f.name === key);
    if (!field) {
      // Unknown field — pass through (Baserow will ignore unknown fields)
      normalized[key] = val;
      continue;
    }

    if (field.type === 'single_select') {
      // Baserow accepts string value or option ID (with user_field_names=true)
      normalized[key] = val;
    } else if (field.type === 'multiple_select') {
      // Gateway accepts comma-separated string, Baserow accepts array of values
      if (typeof val === 'string') {
        normalized[key] = val.split(',').map(v => v.trim()).filter(Boolean);
      } else {
        normalized[key] = val;
      }
    } else if (field.type === 'link_row') {
      // Baserow accepts array of row IDs
      if (Array.isArray(val)) {
        normalized[key] = val.map(v => typeof v === 'object' ? (v.Id || v.id) : v).filter(Boolean);
      } else {
        normalized[key] = val;
      }
    } else if (field.type === 'file') {
      // Baserow file fields expect [{name: "server_filename"}]
      if (Array.isArray(val)) {
        normalized[key] = val.map(f => {
          if (typeof f === 'object' && f !== null) {
            // 'name' = server filename (from upload response or round-tripped)
            if (f.name) return { name: f.name };
            // 'title' = server filename (from normalizeRowForGateway which maps name→title)
            if (f.title) return { name: f.title };
            // Try to extract server filename from URL path
            if (f.url || f.path) {
              const url = f.url || f.path;
              const match = url.match(/\/([^/]+)$/);
              if (match) return { name: match[1] };
            }
          }
          return f;
        });
      } else {
        normalized[key] = val;
      }
    } else if (field.type === 'boolean') {
      normalized[key] = val === true || val === 'true' || val === 1 || val === '1';
    } else if (field.type === 'number') {
      // Ensure numeric value
      if (val !== null && val !== '' && val !== undefined) {
        const num = Number(val);
        normalized[key] = isNaN(num) ? val : num;
      } else {
        normalized[key] = null;
      }
    } else {
      normalized[key] = val;
    }
  }
  return normalized;
}

// ─── Build Baserow filter query params ────────────
// Baserow uses field-type-aware filter names for some types
function getBaserowFilterType(fieldType, op) {
  const baseOp = OP_TO_BR[op] || 'equal';
  // Single/multiple select fields use prefixed filter types
  if (fieldType === 'single_select') {
    const selectOpMap = {
      'equal': 'single_select_equal',
      'not_equal': 'single_select_not_equal',
      'empty': 'empty',
      'not_empty': 'not_empty',
    };
    return selectOpMap[baseOp] || `single_select_${baseOp}`;
  }
  if (fieldType === 'multiple_select') {
    const selectOpMap = {
      'equal': 'multiple_select_has',
      'not_equal': 'multiple_select_has_not',
      'contains': 'multiple_select_has',
      'contains_not': 'multiple_select_has_not',
      'empty': 'empty',
      'not_empty': 'not_empty',
    };
    return selectOpMap[baseOp] || `multiple_select_${baseOp}`;
  }
  if (fieldType === 'boolean') {
    return 'boolean';
  }
  if (fieldType === 'link_row') {
    const linkOpMap = {
      'equal': 'link_row_has',
      'not_equal': 'link_row_has_not',
      'contains': 'link_row_contains',
      'contains_not': 'link_row_contains_not',
      'empty': 'empty',
      'not_empty': 'not_empty',
    };
    return linkOpMap[baseOp] || 'link_row_has';
  }
  if (fieldType === 'date' || fieldType === 'last_modified' || fieldType === 'created_on') {
    const dateOpMap = {
      'equal': 'date_equal',
      'not_equal': 'date_not_equal',
      'higher_than': 'date_after',
      'higher_than_or_equal': 'date_after_or_equal',
      'lower_than': 'date_before',
      'lower_than_or_equal': 'date_before_or_equal',
      'empty': 'empty',
      'not_empty': 'not_empty',
    };
    return dateOpMap[baseOp] || baseOp;
  }
  return baseOp;
}

/** Reverse-map Baserow filter type back to gateway comparison_op */
function reverseBaserowFilterType(brType) {
  // Build reverse map from BR_TO_GW
  const reverseMap = {
    'equal': 'eq', 'not_equal': 'neq',
    'contains': 'like', 'contains_not': 'nlike',
    'higher_than': 'gt', 'higher_than_or_equal': 'gte',
    'lower_than': 'lt', 'lower_than_or_equal': 'lte',
    'empty': 'null', 'not_empty': 'notnull',
    // Select types
    'single_select_equal': 'eq', 'single_select_not_equal': 'neq',
    'multiple_select_has': 'eq', 'multiple_select_has_not': 'neq',
    // Link types
    'link_row_has': 'eq', 'link_row_has_not': 'neq',
    'link_row_contains': 'like', 'link_row_contains_not': 'nlike',
    // Date types
    'date_equal': 'eq', 'date_not_equal': 'neq',
    'date_after': 'gt', 'date_after_or_equal': 'gte',
    'date_before': 'lt', 'date_before_or_equal': 'lte',
    // Boolean
    'boolean': 'eq',
  };
  return reverseMap[brType] || brType;
}

function buildBaserowFilterParams(whereFilters, fieldMap) {
  const params = new URLSearchParams();
  for (const filter of whereFilters) {
    const field = fieldMap[filter.field];
    if (!field) continue;

    if (filter.op === 'null' || filter.op === 'notnull') {
      const brFilterType = getBaserowFilterType(field.type, filter.op);
      params.append(`filter__field_${field.id}__${brFilterType}`, '');
    } else if (filter.op === 'in' || filter.op === 'notin') {
      // 'in' = value matches any in comma-separated list
      // Expand to multiple Baserow equal/not_equal filters
      const values = filter.value.split(',').map(v => v.trim()).filter(Boolean);
      const baseOp = filter.op === 'in' ? 'equal' : 'not_equal';
      const brFilterType = getBaserowFilterType(field.type, filter.op === 'in' ? 'eq' : 'neq');
      for (const val of values) {
        let filterValue = val;
        if ((field.type === 'single_select' || field.type === 'multiple_select') && field.select_options) {
          const opt = field.select_options.find(o => o.value === filterValue);
          if (opt) filterValue = String(opt.id);
        }
        params.append(`filter__field_${field.id}__${brFilterType}`, filterValue);
      }
      // For 'in', filters should be OR'd (Baserow ORs same-field filters by default)
      if (filter.op === 'in' && values.length > 1) {
        params.set('filter_type', 'OR');
      }
    } else {
      const brFilterType = getBaserowFilterType(field.type, filter.op);
      let filterValue = filter.value;
      // Strip SQL-style wildcards for contains/contains_not — Baserow does substring matching natively
      if ((filter.op === 'like' || filter.op === 'nlike') && filterValue) {
        filterValue = filterValue.replace(/^%|%$/g, '');
      }
      if ((field.type === 'single_select' || field.type === 'multiple_select') && field.select_options) {
        const opt = field.select_options.find(o => o.value === filterValue);
        if (opt) filterValue = String(opt.id);
      }
      params.append(`filter__field_${field.id}__${brFilterType}`, filterValue);
    }
  }
  return params;
}

// ─── Build Baserow order_by from sort param ──────
function buildBaserowOrderBy(sort, fieldMap) {
  if (!sort) return '';
  // Sort format: -fieldname (desc) or fieldname (asc), comma-separated
  return sort.split(',').map(s => {
    const desc = s.startsWith('-');
    const name = desc ? s.slice(1) : s;
    // 'Id' is the gateway's row ID — skip it, Baserow sorts by id by default
    // With user_field_names=true, 'id' is not recognized in order_by
    if (name === 'Id' || name === 'id') return null;
    const field = fieldMap[name];
    if (!field) return desc ? `-${name}` : name;
    return desc ? `-field_${field.id}` : `field_${field.id}`;
  }).filter(Boolean).join(',');
}

// ─── Build Baserow field creation body ────────────
function buildFieldCreateBody(title, uidt, options = {}) {
  const brType = UIDT_TO_BR[uidt] || 'text';
  const body = { name: title, type: brType };

  // Select options
  if (brType === 'single_select' || brType === 'multiple_select') {
    if (options.options && options.options.length > 0) {
      body.select_options = options.options.map(o => ({
        value: typeof o === 'string' ? o : o.title,
        color: o.color || 'light-blue',
      }));
    }
  }

  // Number with decimal places
  if (brType === 'number') {
    if (options.meta?.decimals) {
      body.number_decimal_places = options.meta.decimals;
    }
    if (uidt === 'Decimal') {
      body.number_decimal_places = body.number_decimal_places || 2;
    }
  }

  // Link row
  if (brType === 'link_row' && options.childId) {
    body.link_row_table_id = parseInt(options.childId, 10);
    if (options.relationType === 'mm') {
      body.has_related_field = true;
    }
  }

  // Lookup
  if (brType === 'lookup' && options.fk_relation_column_id && options.fk_lookup_column_id) {
    body.through_field_id = parseInt(options.fk_relation_column_id, 10);
    body.target_field_id = parseInt(options.fk_lookup_column_id, 10);
  }

  // Formula
  if (brType === 'formula' && options.formula_raw) {
    body.formula = options.formula_raw;
  }

  // Rating
  if (uidt === 'Rating') {
    body.max_value = options.meta?.max || 5;
    body.style = options.meta?.style || 'star';
  }

  // Date
  if (brType === 'date') {
    body.date_format = 'ISO';
    if (uidt === 'DateTime') {
      body.date_include_time = true;
    }
  }

  return body;
}

// ─── Exports ──────────────────────────────────────
export {
  BR_URL, BR_EMAIL, BR_PASSWORD, BR_DATABASE_ID, BR_TOKEN,
  getBrJwt, br,
  UIDT_TO_BR, BR_TO_UIDT,
  parseWhere, OP_TO_BR, getBaserowFilterType, reverseBaserowFilterType, buildBaserowFilterParams, buildBaserowOrderBy,
  BR_VIEW_TYPE_MAP, BR_VIEW_TYPE_NUM,
  getTableFields, invalidateFieldCache, getFieldMap,
  normalizeRowForGateway, normalizeRowForBaserow,
  buildFieldCreateBody,
};
