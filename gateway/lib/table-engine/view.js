/**
 * View configuration: views, filters, sorts, view_columns.
 *
 * View deletion cascades via FK ON DELETE CASCADE to filters/sorts/columns.
 * Field deletion (in schema.dropField) clears all view_filters/view_sorts/
 * view_columns referencing the field — that path is in schema.js (I6).
 */

import crypto from 'node:crypto';

function genId(prefix) { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }

const VIEW_TYPES = new Set(['grid', 'kanban', 'gallery', 'form']);

function validationError(msg) {
  const e = new Error(msg);
  e.code = 'VALIDATION_ERROR';
  return e;
}

export function createView(db) {
  // ── views ──
  function createView({ table_id, title, view_type, options = null, is_default = 0 }) {
    if (!table_id) throw validationError('view requires table_id');
    if (!title) throw validationError('view requires title');
    if (!VIEW_TYPES.has(view_type)) throw validationError(`unknown view_type: ${view_type}`);
    const id = genId('uvw');
    const now = Date.now();
    const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM user_views WHERE table_id = ?').get(table_id);
    const position = (max?.m ?? -1) + 1;
    db.prepare(`INSERT INTO user_views (id, table_id, title, view_type, position, is_default, options, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, table_id, title, view_type, position, is_default ? 1 : 0,
        options ? JSON.stringify(options) : null, now, now);
    return getView(id);
  }

  function getView(id) {
    const v = db.prepare('SELECT * FROM user_views WHERE id = ?').get(id);
    if (!v) return null;
    if (v.options) try { v.options = JSON.parse(v.options); } catch { v.options = null; }
    return v;
  }

  function listViews(tableId) {
    const rows = db.prepare('SELECT * FROM user_views WHERE table_id = ? ORDER BY position').all(tableId);
    for (const v of rows) {
      if (v.options) try { v.options = JSON.parse(v.options); } catch { v.options = null; }
    }
    return rows;
  }

  function updateView(id, patch) {
    const v = db.prepare('SELECT * FROM user_views WHERE id = ?').get(id);
    if (!v) throw validationError('view not found');
    const next = {
      title: 'title' in patch ? patch.title : v.title,
      position: 'position' in patch ? patch.position : v.position,
      is_default: 'is_default' in patch ? (patch.is_default ? 1 : 0) : v.is_default,
      options: 'options' in patch ? JSON.stringify(patch.options) : v.options,
    };
    db.prepare('UPDATE user_views SET title = ?, position = ?, is_default = ?, options = ?, updated_at = ? WHERE id = ?')
      .run(next.title, next.position, next.is_default, next.options, Date.now(), id);
    return getView(id);
  }

  function deleteView(id) {
    db.prepare('DELETE FROM user_views WHERE id = ?').run(id);
    return { ok: true };
  }

  // ── filters ──
  function listFilters(viewId) {
    return db.prepare('SELECT * FROM user_view_filters WHERE view_id = ? ORDER BY position').all(viewId);
  }
  function addFilter(viewId, { field_id, operator, value, conjunction = 'and' }) {
    const id = genId('uvf');
    const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM user_view_filters WHERE view_id = ?').get(viewId);
    db.prepare(`INSERT INTO user_view_filters (id, view_id, field_id, operator, value, conjunction, position) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, viewId, field_id, operator, value !== null && value !== undefined ? JSON.stringify(value) : null, conjunction, (max?.m ?? -1) + 1);
    return db.prepare('SELECT * FROM user_view_filters WHERE id = ?').get(id);
  }
  function deleteFilter(id) {
    db.prepare('DELETE FROM user_view_filters WHERE id = ?').run(id);
    return { ok: true };
  }
  function updateFilter(id, patch) {
    const existing = db.prepare('SELECT * FROM user_view_filters WHERE id = ?').get(id);
    if (!existing) throw validationError('filter not found');
    const next = {
      field_id: 'field_id' in patch ? patch.field_id : existing.field_id,
      operator: 'operator' in patch ? patch.operator : existing.operator,
      value: 'value' in patch
        ? (patch.value !== null && patch.value !== undefined ? JSON.stringify(patch.value) : null)
        : existing.value,
      conjunction: 'conjunction' in patch ? patch.conjunction : existing.conjunction,
    };
    db.prepare('UPDATE user_view_filters SET field_id = ?, operator = ?, value = ?, conjunction = ? WHERE id = ?')
      .run(next.field_id, next.operator, next.value, next.conjunction, id);
    return db.prepare('SELECT * FROM user_view_filters WHERE id = ?').get(id);
  }

  // ── sorts ──
  function listSorts(viewId) {
    return db.prepare('SELECT * FROM user_view_sorts WHERE view_id = ? ORDER BY position').all(viewId);
  }
  function addSort(viewId, { field_id, direction = 'asc' }) {
    const id = genId('uvs');
    const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM user_view_sorts WHERE view_id = ?').get(viewId);
    db.prepare('INSERT INTO user_view_sorts (id, view_id, field_id, direction, position) VALUES (?, ?, ?, ?, ?)')
      .run(id, viewId, field_id, direction, (max?.m ?? -1) + 1);
    return db.prepare('SELECT * FROM user_view_sorts WHERE id = ?').get(id);
  }
  function deleteSort(id) {
    db.prepare('DELETE FROM user_view_sorts WHERE id = ?').run(id);
    return { ok: true };
  }
  function updateSort(id, patch) {
    const existing = db.prepare('SELECT * FROM user_view_sorts WHERE id = ?').get(id);
    if (!existing) throw validationError('sort not found');
    const next = {
      field_id: 'field_id' in patch ? patch.field_id : existing.field_id,
      direction: 'direction' in patch ? patch.direction : existing.direction,
    };
    db.prepare('UPDATE user_view_sorts SET field_id = ?, direction = ? WHERE id = ?')
      .run(next.field_id, next.direction, id);
    return db.prepare('SELECT * FROM user_view_sorts WHERE id = ?').get(id);
  }

  // ── view columns (visibility / order / width) ──
  function listColumns(viewId) {
    return db.prepare('SELECT * FROM user_view_columns WHERE view_id = ? ORDER BY position').all(viewId);
  }
  function setColumn(viewId, fieldId, { visible = 1, position = null, width = null } = {}) {
    const existing = db.prepare('SELECT id FROM user_view_columns WHERE view_id = ? AND field_id = ?').get(viewId, fieldId);
    if (existing) {
      db.prepare('UPDATE user_view_columns SET visible = COALESCE(?, visible), position = COALESCE(?, position), width = COALESCE(?, width) WHERE id = ?')
        .run(visible, position, width, existing.id);
      return db.prepare('SELECT * FROM user_view_columns WHERE id = ?').get(existing.id);
    } else {
      const id = genId('uvc');
      const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM user_view_columns WHERE view_id = ?').get(viewId);
      db.prepare('INSERT INTO user_view_columns (id, view_id, field_id, visible, position, width) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, viewId, fieldId, visible, position ?? ((max?.m ?? -1) + 1), width);
      return db.prepare('SELECT * FROM user_view_columns WHERE id = ?').get(id);
    }
  }

  return {
    createView,
    getView,
    listViews,
    updateView,
    deleteView,
    listFilters,
    addFilter,
    updateFilter,
    deleteFilter,
    listSorts,
    addSort,
    updateSort,
    deleteSort,
    listColumns,
    setColumn,
  };
}
