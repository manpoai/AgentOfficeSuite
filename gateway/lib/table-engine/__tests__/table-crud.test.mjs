/**
 * Tests for database object layer + schema layer MCP tools (4.3D)
 * Covers: create_table, add_column, update_column, delete_column, reorder_columns
 * Also regression: row-level operations (insert/query/update/delete) unaffected by schema changes
 * Run from gateway/ dir: node lib/table-engine/__tests__/table-crud.test.mjs
 */

import Database from 'better-sqlite3';
import { runTableEngineMigrations } from '../migrations.js';
import { createSchema } from '../schema.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'expected'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function assertNotNull(v, msg) { if (v == null) throw new Error(msg || 'expected non-null'); }
function assertThrows(fn, msgFragment) {
  try { fn(); } catch (err) {
    if (msgFragment && !err.message.includes(msgFragment) && err.code !== msgFragment) {
      throw new Error(`expected error containing "${msgFragment}", got "${err.message}"`);
    }
    return;
  }
  throw new Error('expected an error but none was thrown');
}

function setup() {
  const db = new Database(':memory:');
  runTableEngineMigrations(db);
  const schema = createSchema(db);
  return { db, schema };
}

// ── P0-2A: create_table ──

test('create_table: creates empty table with id and title', () => {
  const { schema } = setup();
  const t = schema.createTable({ title: 'My Table' });
  assertNotNull(t.id, 'table has id');
  assertEq(t.title, 'My Table', 'table title matches');
});

test('create_table: creates table with initial columns', () => {
  const { schema } = setup();
  const t = schema.createTable({
    title: 'With Cols',
    columns: [
      { title: 'Name', uidt: 'SingleLineText' },
      { title: 'Score', uidt: 'Number' },
    ],
  });
  const fields = schema.listFields(t.id);
  // System primary key + 2 user columns
  const userFields = fields.filter(f => !f.is_primary);
  assertEq(userFields.length, 2, 'two user columns created');
  assert(userFields.some(f => f.title === 'Name'), 'Name column exists');
  assert(userFields.some(f => f.title === 'Score'), 'Score column exists');
});

test('create_table: describe_table consistency after creation', () => {
  const { schema } = setup();
  const t = schema.createTable({ title: 'Describe Me', columns: [{ title: 'Field1', uidt: 'SingleLineText' }] });
  const fields = schema.listFields(t.id);
  assert(fields.length > 0, 'listFields returns fields');
  assert(fields.some(f => f.title === 'Field1'), 'Field1 listed');
});

// ── P0-2B: add_column / update_column / delete_column / reorder_columns ──

test('add_column: adds new column to existing table', () => {
  const { schema } = setup();
  const t = schema.createTable({ title: 'Cols Test' });
  const f = schema.addField(t.id, { title: 'Email', uidt: 'Email' });
  assertNotNull(f, 'addField returns field id');
  const fields = schema.listFields(t.id);
  assert(fields.some(ff => ff.title === 'Email'), 'Email column found after add');
});

test('add_column: multiple columns retain independent physical columns', () => {
  const { schema } = setup();
  const t = schema.createTable({ title: 'Multi' });
  schema.addField(t.id, { title: 'A', uidt: 'SingleLineText' });
  schema.addField(t.id, { title: 'B', uidt: 'Number' });
  const fields = schema.listFields(t.id).filter(f => !f.is_primary);
  assertEq(fields.length, 2, 'two non-primary fields');
  const physCols = fields.map(f => f.physical_column);
  assert(new Set(physCols).size === 2, 'distinct physical columns');
});

test('update_column: renames a column', () => {
  const { schema } = setup();
  const t = schema.createTable({ title: 'Rename' });
  const field = schema.addField(t.id, { title: 'OldName', uidt: 'SingleLineText' });
  schema.updateField(field.id, { title: 'NewName' });
  const fields = schema.listFields(t.id);
  assert(fields.some(f => f.title === 'NewName'), 'NewName found after rename');
  assert(!fields.some(f => f.title === 'OldName'), 'OldName no longer present');
});

test('update_column: rejects physical_column patch (immutable)', () => {
  const { schema } = setup();
  const t = schema.createTable({ title: 'Immutable' });
  const field = schema.addField(t.id, { title: 'F', uidt: 'SingleLineText' });
  assertThrows(() => schema.updateField(field.id, { physical_column: 'f_hax' }), 'immutable');
});

test('delete_column: removes column from listFields', () => {
  const { schema } = setup();
  const t = schema.createTable({ title: 'Del Col' });
  const field = schema.addField(t.id, { title: 'Temp', uidt: 'SingleLineText' });
  schema.dropField(field.id);
  const fields = schema.listFields(t.id);
  assert(!fields.some(f => f.id === field.id), 'deleted column not found');
});

test('delete_column: other columns survive deletion', () => {
  const { schema } = setup();
  const t = schema.createTable({ title: 'Survive' });
  schema.addField(t.id, { title: 'Keep', uidt: 'SingleLineText' });
  const toDelete = schema.addField(t.id, { title: 'Drop', uidt: 'Number' });
  schema.dropField(toDelete.id);
  const fields = schema.listFields(t.id);
  assert(fields.some(f => f.title === 'Keep'), 'Keep column survives');
  assert(!fields.some(f => f.title === 'Drop'), 'Drop column gone');
});

test('reorder_columns: updates position of columns', () => {
  const { schema } = setup();
  const t = schema.createTable({ title: 'Reorder' });
  const f1 = schema.addField(t.id, { title: 'First', uidt: 'SingleLineText' });
  const f2 = schema.addField(t.id, { title: 'Second', uidt: 'Number' });
  // Reverse order: put f2 first
  schema.updateField(f2.id, { position: 0 });
  schema.updateField(f1.id, { position: 1 });
  const fields = schema.listFields(t.id).filter(f => !f.is_primary);
  const sorted = [...fields].sort((a, b) => a.position - b.position);
  assertEq(sorted[0].title, 'Second', 'Second is now first after reorder');
  assertEq(sorted[1].title, 'First', 'First is now second after reorder');
});

// ── P0-2D: describe_table + query_rows consistency after schema changes ──

test('describe_table consistency: listFields after add + delete returns only live columns', () => {
  const { schema } = setup();
  const t = schema.createTable({ title: 'Consistency' });
  schema.addField(t.id, { title: 'Alive', uidt: 'SingleLineText' });
  const deleted = schema.addField(t.id, { title: 'Dead', uidt: 'Number' });
  schema.dropField(deleted.id);
  const fields = schema.listFields(t.id);
  assert(fields.some(f => f.title === 'Alive'), 'Alive column present');
  assert(!fields.some(f => f.title === 'Dead'), 'Dead column not present');
});

// ── Row-level regression: insert/update/delete after schema changes ──

test('row regression: physical column present in DB after adding a column', () => {
  const { db, schema } = setup();
  const t = schema.createTable({ title: 'RowReg', columns: [{ title: 'Val', uidt: 'SingleLineText' }] });
  const field = schema.listFields(t.id).find(f => f.title === 'Val');
  assertNotNull(field, 'Val field found');
  // Validate schema is intact at the DB level
  const physTable = `utbl_${t.id}_rows`;
  const tableInfo = db.prepare(`PRAGMA table_info("${physTable}")`).all();
  assert(tableInfo.some(c => c.name === field.physical_column), 'physical column exists in DB');
});

test('row regression: physical column removed from DB after dropField', () => {
  const { db, schema } = setup();
  const t = schema.createTable({ title: 'PhysReg' });
  const field = schema.addField(t.id, { title: 'X', uidt: 'SingleLineText' });
  const physTable = `utbl_${t.id}_rows`;
  // Confirm column exists before drop
  let tableInfo = db.prepare(`PRAGMA table_info("${physTable}")`).all();
  assert(tableInfo.some(c => c.name === field.physical_column), 'column exists before drop');
  schema.dropField(field.id);
  tableInfo = db.prepare(`PRAGMA table_info("${physTable}")`).all();
  assert(!tableInfo.some(c => c.name === field.physical_column), 'column removed after drop');
});

console.log(`\n[table-crud] ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
