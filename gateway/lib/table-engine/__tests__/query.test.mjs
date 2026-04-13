/**
 * P4.1.5 query-builder.js tests: QT1-13
 * QT14 (10k row perf) covered separately.
 */
import Database from 'better-sqlite3';
import { runTableEngineMigrations } from '../migrations.js';
import { createSchema } from '../schema.js';
import { createSelect } from '../select.js';
import { createLink } from '../link.js';
import { createRowIo } from '../row-io.js';
import { buildSelectQuery } from '../query-builder.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.error(`  ✗ ${name}\n      ${err.message}`); }
}
function assertEq(a, b, m) { if (a !== b) throw new Error(`${m||'eq'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function assert(c, m) { if (!c) throw new Error(m || 'fail'); }

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runTableEngineMigrations(db);
  const schema = createSchema(db);
  const select = createSelect(db);
  const link = createLink(db);
  const rowIo = createRowIo(db, { linkApi: link });
  return { db, schema, select, link, rowIo };
}

function runQuery(db, table, fields, opts) {
  const { sql, params } = buildSelectQuery({ table, fields, ...opts });
  return db.prepare(sql).all(...params);
}

console.log('\n[P4.1.5] query-builder.js tests');

test('QT1: no filter / no sort → default order by created_at DESC', () => {
  const { db, schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'a', uidt: 'SingleLineText' });
  rowIo.insertRow(t.id, { [f.id]: 'first' });
  rowIo.insertRow(t.id, { [f.id]: 'second' });
  const fields = schema.listFields(t.id);
  const rows = runQuery(db, t, fields, {});
  assertEq(rows.length, 2);
  assertEq(rows[0][f.physical_column], 'second', 'newest first');
});

test('QT2: text contains filter', () => {
  const { db, schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'a', uidt: 'SingleLineText' });
  rowIo.insertRow(t.id, { [f.id]: 'hello world' });
  rowIo.insertRow(t.id, { [f.id]: 'goodbye' });
  const rows = runQuery(db, t, schema.listFields(t.id), {
    filters: [{ field_id: f.id, operator: 'contains', value: 'hello' }],
  });
  assertEq(rows.length, 1);
});

test('QT3: number gt / lt filter', () => {
  const { db, schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'n', uidt: 'Number' });
  for (const n of [1, 5, 10, 50, 100]) rowIo.insertRow(t.id, { [f.id]: n });
  const rows = runQuery(db, t, schema.listFields(t.id), {
    filters: [{ field_id: f.id, operator: 'gt', value: 5 }],
  });
  assertEq(rows.length, 3);
});

test('QT4: datetime range filter', () => {
  const { db, schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'd', uidt: 'DateTime' });
  rowIo.insertRow(t.id, { [f.id]: 1000 });
  rowIo.insertRow(t.id, { [f.id]: 2000 });
  rowIo.insertRow(t.id, { [f.id]: 3000 });
  const rows = runQuery(db, t, schema.listFields(t.id), {
    filters: [
      { field_id: f.id, operator: 'gte', value: 1500 },
      { field_id: f.id, operator: 'lte', value: 2500, conjunction: 'and' },
    ],
  });
  assertEq(rows.length, 1);
  assertEq(rows[0][f.physical_column], 2000);
});

test('QT5: SingleSelect eq filter', () => {
  const { db, schema, rowIo, select } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 's', uidt: 'SingleSelect' });
  const a = select.addOption(f.id, { value: 'A' });
  const b = select.addOption(f.id, { value: 'B' });
  rowIo.insertRow(t.id, { [f.id]: a.id });
  rowIo.insertRow(t.id, { [f.id]: a.id });
  rowIo.insertRow(t.id, { [f.id]: b.id });
  const rows = runQuery(db, t, schema.listFields(t.id), {
    filters: [{ field_id: f.id, operator: 'eq', value: a.id }],
  });
  assertEq(rows.length, 2);
});

test('QT6: MultiSelect has_any filter', () => {
  const { db, schema, rowIo, select } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'm', uidt: 'MultiSelect' });
  const a = select.addOption(f.id, { value: 'A' });
  const b = select.addOption(f.id, { value: 'B' });
  const c = select.addOption(f.id, { value: 'C' });
  rowIo.insertRow(t.id, { [f.id]: [a.id, b.id] });
  rowIo.insertRow(t.id, { [f.id]: [c.id] });
  rowIo.insertRow(t.id, { [f.id]: [a.id, c.id] });
  const rows = runQuery(db, t, schema.listFields(t.id), {
    filters: [{ field_id: f.id, operator: 'has_any', value: [a.id] }],
  });
  assertEq(rows.length, 2);
});

test('QT7: Link has_any filter (JSON cache column)', () => {
  const { db, schema, rowIo } = setup();
  const target = schema.createTable({ title: 'T' });
  const src = schema.createTable({ title: 'S' });
  const lf = schema.addField(src.id, { title: 'L', uidt: 'Links', options: { target_table_id: target.id } });
  const t1 = rowIo.insertRow(target.id, {});
  const t2 = rowIo.insertRow(target.id, {});
  rowIo.insertRow(src.id, { [lf.id]: [t1.id] });
  rowIo.insertRow(src.id, { [lf.id]: [t2.id] });
  const rows = runQuery(db, src, schema.listFields(src.id), {
    filters: [{ field_id: lf.id, operator: 'has_any', value: [t1.id] }],
  });
  assertEq(rows.length, 1);
});

test('QT8: AND combined filter', () => {
  const { db, schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const fA = schema.addField(t.id, { title: 'a', uidt: 'SingleLineText' });
  const fB = schema.addField(t.id, { title: 'b', uidt: 'Number' });
  rowIo.insertRow(t.id, { [fA.id]: 'x', [fB.id]: 1 });
  rowIo.insertRow(t.id, { [fA.id]: 'x', [fB.id]: 100 });
  rowIo.insertRow(t.id, { [fA.id]: 'y', [fB.id]: 100 });
  const rows = runQuery(db, t, schema.listFields(t.id), {
    filters: [
      { field_id: fA.id, operator: 'eq', value: 'x' },
      { field_id: fB.id, operator: 'gt', value: 50, conjunction: 'and' },
    ],
  });
  assertEq(rows.length, 1);
});

test('QT9: OR combined filter', () => {
  const { db, schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const fA = schema.addField(t.id, { title: 'a', uidt: 'SingleLineText' });
  rowIo.insertRow(t.id, { [fA.id]: 'red' });
  rowIo.insertRow(t.id, { [fA.id]: 'green' });
  rowIo.insertRow(t.id, { [fA.id]: 'blue' });
  const rows = runQuery(db, t, schema.listFields(t.id), {
    filters: [
      { field_id: fA.id, operator: 'eq', value: 'red' },
      { field_id: fA.id, operator: 'eq', value: 'blue', conjunction: 'or' },
    ],
  });
  assertEq(rows.length, 2);
});

test('QT10: multi-field sort', () => {
  const { db, schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const fA = schema.addField(t.id, { title: 'a', uidt: 'SingleLineText' });
  const fB = schema.addField(t.id, { title: 'b', uidt: 'Number' });
  rowIo.insertRow(t.id, { [fA.id]: 'b', [fB.id]: 1 });
  rowIo.insertRow(t.id, { [fA.id]: 'a', [fB.id]: 2 });
  rowIo.insertRow(t.id, { [fA.id]: 'a', [fB.id]: 1 });
  const rows = runQuery(db, t, schema.listFields(t.id), {
    sorts: [
      { field_id: fA.id, direction: 'asc' },
      { field_id: fB.id, direction: 'desc' },
    ],
  });
  assertEq(rows[0][fA.physical_column], 'a');
  assertEq(rows[0][fB.physical_column], 2);
  assertEq(rows[1][fA.physical_column], 'a');
  assertEq(rows[1][fB.physical_column], 1);
});

test('QT11: LIMIT / OFFSET pagination', () => {
  const { db, schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'n', uidt: 'Number' });
  for (let i = 0; i < 20; i++) rowIo.insertRow(t.id, { [f.id]: i });
  const page1 = runQuery(db, t, schema.listFields(t.id), { limit: 5, offset: 0 });
  const page2 = runQuery(db, t, schema.listFields(t.id), { limit: 5, offset: 5 });
  assertEq(page1.length, 5);
  assertEq(page2.length, 5);
  assert(page1[0].id !== page2[0].id, 'pages differ');
});

test('QT12: search across primary field', () => {
  const { db, schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const fA = schema.addField(t.id, { title: 'a', uidt: 'SingleLineText', is_primary: 1 });
  rowIo.insertRow(t.id, { [fA.id]: 'apple pie' });
  rowIo.insertRow(t.id, { [fA.id]: 'banana bread' });
  const rows = runQuery(db, t, schema.listFields(t.id), { search: 'apple' });
  assertEq(rows.length, 1);
});

test('QT13: SQL injection prevented (params bound)', () => {
  const { db, schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'a', uidt: 'SingleLineText' });
  rowIo.insertRow(t.id, { [f.id]: 'hello' });
  // try to inject
  const rows = runQuery(db, t, schema.listFields(t.id), {
    filters: [{ field_id: f.id, operator: 'eq', value: "x'; DROP TABLE user_tables;--" }],
  });
  assertEq(rows.length, 0);
  // user_tables still exists
  const ut = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_tables'").get();
  assert(ut, 'user_tables survived');
});

console.log(`\n[P4.1.5] ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
