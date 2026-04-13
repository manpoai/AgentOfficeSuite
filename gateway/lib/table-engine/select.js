/**
 * SingleSelect / MultiSelect option management.
 *
 * Options live in user_select_options. Physical row columns store option_id
 * (TEXT for SingleSelect) or JSON array of option_ids (TEXT for MultiSelect).
 *
 * deleteOption: any row referencing the deleted option_id has that field
 * NULLed (SingleSelect) or the option_id removed from its JSON array
 * (MultiSelect). Done in one transaction.
 */

import crypto from 'node:crypto';

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function quoteIdent(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return `"${name}"`;
}

function physicalTableName(tableId) { return `utbl_${tableId}_rows`; }

export function createSelect(db) {
  function listOptions(fieldId) {
    return db.prepare('SELECT * FROM user_select_options WHERE field_id = ? ORDER BY position').all(fieldId);
  }

  function addOption(fieldId, { value, color = null, position = null }) {
    const f = db.prepare('SELECT * FROM user_fields WHERE id = ?').get(fieldId);
    if (!f) throw Object.assign(new Error('field not found'), { code: 'VALIDATION_ERROR' });
    if (f.uidt !== 'SingleSelect' && f.uidt !== 'MultiSelect') {
      throw Object.assign(new Error('addOption only valid on SingleSelect/MultiSelect'), { code: 'VALIDATION_ERROR' });
    }
    if (position === null) {
      const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM user_select_options WHERE field_id = ?').get(fieldId);
      position = (max?.m ?? -1) + 1;
    }
    const id = genId('uopt');
    db.prepare(`INSERT INTO user_select_options (id, field_id, table_id, value, color, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, fieldId, f.table_id, value, color, position, Date.now());
    return db.prepare('SELECT * FROM user_select_options WHERE id = ?').get(id);
  }

  function updateOption(optionId, patch) {
    const o = db.prepare('SELECT * FROM user_select_options WHERE id = ?').get(optionId);
    if (!o) throw Object.assign(new Error('option not found'), { code: 'VALIDATION_ERROR' });
    const next = {
      value: 'value' in patch ? patch.value : o.value,
      color: 'color' in patch ? patch.color : o.color,
      position: 'position' in patch ? patch.position : o.position,
    };
    db.prepare('UPDATE user_select_options SET value = ?, color = ?, position = ? WHERE id = ?')
      .run(next.value, next.color, next.position, optionId);
    return db.prepare('SELECT * FROM user_select_options WHERE id = ?').get(optionId);
  }

  function deleteOption(optionId) {
    const o = db.prepare('SELECT * FROM user_select_options WHERE id = ?').get(optionId);
    if (!o) throw Object.assign(new Error('option not found'), { code: 'VALIDATION_ERROR' });
    const f = db.prepare('SELECT * FROM user_fields WHERE id = ?').get(o.field_id);
    if (!f) throw Object.assign(new Error('field not found'), { code: 'VALIDATION_ERROR' });
    const physName = physicalTableName(f.table_id);

    const tx = db.transaction(() => {
      if (f.uidt === 'SingleSelect') {
        db.exec(`UPDATE ${quoteIdent(physName)} SET ${quoteIdent(f.physical_column)} = NULL
          WHERE ${quoteIdent(f.physical_column)} = '${optionId.replace(/'/g, "''")}'`);
      } else if (f.uidt === 'MultiSelect') {
        // Strip option_id from JSON arrays. Read each row, parse, filter, write back.
        const rows = db.prepare(`SELECT id, ${quoteIdent(f.physical_column)} AS v FROM ${quoteIdent(physName)} WHERE ${quoteIdent(f.physical_column)} IS NOT NULL`).all();
        const updateStmt = db.prepare(`UPDATE ${quoteIdent(physName)} SET ${quoteIdent(f.physical_column)} = ? WHERE id = ?`);
        for (const r of rows) {
          let arr;
          try { arr = JSON.parse(r.v); } catch { continue; }
          if (!Array.isArray(arr)) continue;
          const filtered = arr.filter(x => x !== optionId);
          if (filtered.length !== arr.length) {
            updateStmt.run(filtered.length ? JSON.stringify(filtered) : null, r.id);
          }
        }
      }
      db.prepare('DELETE FROM user_select_options WHERE id = ?').run(optionId);
    });
    tx();
    return { ok: true, option_id: optionId };
  }

  return { listOptions, addOption, updateOption, deleteOption };
}
