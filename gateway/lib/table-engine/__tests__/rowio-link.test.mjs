/**
 * P4.1.4 + P4.1.6 row-io.js + link.js tests.
 *
 * Covers: UT3, UT4, UT5, UT10, UT11, UT12, UT13, UT14
 *         LT1, LT2, LT3, LT4, LT5, LT6, LT10, LT11
 *
 * LT4 (bidirectional auto-sync) requires paired_field_id wiring; tested
 * with two manually-paired fields.
 */
import Database from 'better-sqlite3';
import { runTableEngineMigrations } from '../migrations.js';
import { createSchema } from '../schema.js';
import { createSelect } from '../select.js';
import { createLink } from '../link.js';
import { createRowIo } from '../row-io.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.error(`  ✗ ${name}\n      ${err.message}\n      ${err.stack?.split('\n').slice(1, 3).join('\n      ')}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assert failed'); }
function assertEq(a, b, m) { if (a !== b) throw new Error(`${m||'eq'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function assertDeepEq(a, b, m) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m||'deepEq'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function assertThrows(fn, codeOrMsg) {
  try { fn(); } catch (err) {
    if (typeof codeOrMsg === 'string' && err.code !== codeOrMsg && !err.message.includes(codeOrMsg)) {
      throw new Error(`expected error containing ${codeOrMsg}, got ${err.code}/${err.message}`);
    }
    return;
  }
  throw new Error('expected throw');
}

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runTableEngineMigrations(db);
  const schema = createSchema(db);
  const select = createSelect(db);
  const link = createLink(db);
  const rowIo = createRowIo(db, { linkApi: link, schemaApi: schema });
  return { db, schema, select, link, rowIo };
}

console.log('\n[P4.1.4 + P4.1.6] row-io.js + link.js tests');

// ── UT3: insert 22 field types and read back ──
test('UT3: insert + read back covers all non-virtual non-link uidts', () => {
  const { schema, rowIo, select } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = {};
  f.text = schema.addField(t.id, { title: 'text', uidt: 'SingleLineText' });
  f.long = schema.addField(t.id, { title: 'long', uidt: 'LongText' });
  f.num = schema.addField(t.id, { title: 'num', uidt: 'Number' });
  f.dec = schema.addField(t.id, { title: 'dec', uidt: 'Decimal' });
  f.chk = schema.addField(t.id, { title: 'chk', uidt: 'Checkbox' });
  f.dt = schema.addField(t.id, { title: 'dt', uidt: 'DateTime' });
  f.email = schema.addField(t.id, { title: 'email', uidt: 'Email' });
  f.url = schema.addField(t.id, { title: 'url', uidt: 'URL' });
  f.ss = schema.addField(t.id, { title: 'ss', uidt: 'SingleSelect' });
  f.ms = schema.addField(t.id, { title: 'ms', uidt: 'MultiSelect' });
  f.auto = schema.addField(t.id, { title: 'auto', uidt: 'AutoNumber' });
  f.att = schema.addField(t.id, { title: 'att', uidt: 'Attachment' });
  f.rate = schema.addField(t.id, { title: 'rate', uidt: 'Rating' });
  f.phone = schema.addField(t.id, { title: 'phone', uidt: 'PhoneNumber' });
  f.pct = schema.addField(t.id, { title: 'pct', uidt: 'Percent' });
  f.dur = schema.addField(t.id, { title: 'dur', uidt: 'Duration' });
  f.cur = schema.addField(t.id, { title: 'cur', uidt: 'Currency' });

  const optA = select.addOption(f.ss.id, { value: 'A' });
  const optB = select.addOption(f.ms.id, { value: 'B' });
  const optC = select.addOption(f.ms.id, { value: 'C' });

  const inserted = rowIo.insertRow(t.id, {
    [f.text.id]: 'hello',
    [f.long.id]: 'long body',
    [f.num.id]: 42,
    [f.dec.id]: 3.14,
    [f.chk.id]: true,
    [f.dt.id]: 1700000000000,
    [f.email.id]: 'a@b.com',
    [f.url.id]: 'https://example.com',
    [f.ss.id]: optA.id,
    [f.ms.id]: [optB.id, optC.id],
    [f.att.id]: [{ filename: 'x.png', url: '/u/x.png', size: 100, mime: 'image/png' }],
    [f.rate.id]: 4,
    [f.phone.id]: '+15551234',
    [f.pct.id]: 0.85,
    [f.dur.id]: 90000,
    [f.cur.id]: 19.99,
  }, { actor: 'user_1' });

  assert(inserted.id.startsWith('urow_'), 'row id prefix');
  const read = rowIo.readRow(t.id, inserted.id);
  assertEq(read[f.text.id], 'hello');
  assertEq(read[f.num.id], 42);
  assertEq(read[f.dec.id], 3.14);
  assertEq(read[f.chk.id], true);
  assertEq(read[f.email.id], 'a@b.com');
  assertEq(read[f.ss.id], optA.id);
  assertDeepEq(read[f.ms.id], [optB.id, optC.id]);
  assertEq(read[f.rate.id], 4);
  assertEq(read[f.auto.id], 1, 'auto increment starts at 1');
});

// ── UT4: partial update preserves untouched fields ──
test('UT4: updateRow only changes specified fields', () => {
  const { schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const fA = schema.addField(t.id, { title: 'a', uidt: 'SingleLineText' });
  const fB = schema.addField(t.id, { title: 'b', uidt: 'Number' });
  const r = rowIo.insertRow(t.id, { [fA.id]: 'orig', [fB.id]: 100 });
  rowIo.updateRow(t.id, r.id, { [fA.id]: 'changed' });
  const read = rowIo.readRow(t.id, r.id);
  assertEq(read[fA.id], 'changed');
  assertEq(read[fB.id], 100, 'untouched field preserved');
});

// ── UT5: deleteRow removes row + clears any link references ──
test('UT5: deleteRow removes row + cascades user_links', () => {
  const { db, schema, rowIo } = setup();
  const target = schema.createTable({ title: 'T' });
  const t = schema.createTable({ title: 'S' });
  const lf = schema.addField(t.id, { title: 'L', uidt: 'Links', options: { target_table_id: target.id } });
  const targetRow = rowIo.insertRow(target.id, {});
  const srcRow = rowIo.insertRow(t.id, { [lf.id]: [targetRow.id] });
  assertEq(db.prepare('SELECT COUNT(*) AS n FROM user_links WHERE source_row_id = ?').get(srcRow.id).n, 1);
  rowIo.deleteRow(t.id, srcRow.id);
  assertEq(db.prepare('SELECT COUNT(*) AS n FROM user_links WHERE source_row_id = ?').get(srcRow.id).n, 0);
  assert(!rowIo.readRow(t.id, srcRow.id), 'row removed');
});

// ── UT10: SingleSelect addOption — existing rows unchanged ──
test('UT10: addOption does not touch existing rows', () => {
  const { schema, rowIo, select } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'sel', uidt: 'SingleSelect' });
  const optA = select.addOption(f.id, { value: 'A' });
  const r = rowIo.insertRow(t.id, { [f.id]: optA.id });
  const optB = select.addOption(f.id, { value: 'B' });
  const read = rowIo.readRow(t.id, r.id);
  assertEq(read[f.id], optA.id, 'existing row value unchanged');
});

// ── UT11: deleteOption sets referencing rows to NULL (SingleSelect) ──
test('UT11: deleteOption SingleSelect → row value NULLed', () => {
  const { schema, rowIo, select } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'sel', uidt: 'SingleSelect' });
  const optA = select.addOption(f.id, { value: 'A' });
  const r = rowIo.insertRow(t.id, { [f.id]: optA.id });
  select.deleteOption(optA.id);
  const read = rowIo.readRow(t.id, r.id);
  assertEq(read[f.id], null, 'SingleSelect value cleared');
});

test('UT11b: deleteOption MultiSelect → option_id stripped from JSON', () => {
  const { schema, rowIo, select } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'ms', uidt: 'MultiSelect' });
  const optA = select.addOption(f.id, { value: 'A' });
  const optB = select.addOption(f.id, { value: 'B' });
  const r = rowIo.insertRow(t.id, { [f.id]: [optA.id, optB.id] });
  select.deleteOption(optA.id);
  const read = rowIo.readRow(t.id, r.id);
  assertDeepEq(read[f.id], [optB.id]);
});

// ── UT12: MultiSelect batch insert ──
test('UT12: MultiSelect insert → JSON array preserved', () => {
  const { schema, rowIo, select } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'ms', uidt: 'MultiSelect' });
  const o1 = select.addOption(f.id, { value: '1' });
  const o2 = select.addOption(f.id, { value: '2' });
  const o3 = select.addOption(f.id, { value: '3' });
  const r = rowIo.insertRow(t.id, { [f.id]: [o1.id, o2.id, o3.id] });
  const read = rowIo.readRow(t.id, r.id);
  assertDeepEq(read[f.id], [o1.id, o2.id, o3.id]);
});

// ── UT13: batch insert 100 rows is atomic ──
test('UT13: batchInsert 100 rows', () => {
  const { schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'n', uidt: 'Number' });
  const rows = Array.from({ length: 100 }, (_, i) => ({ [f.id]: i }));
  const out = rowIo.batchInsert(t.id, rows);
  assertEq(out.length, 100);
  const all = rowIo.listRows(t.id, { limit: 200 });
  assertEq(all.length, 100);
});

// ── UT14: batch update is atomic — bad row id rolls back ──
test('UT14: batchUpdate rollback on error', () => {
  const { schema, rowIo } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'n', uidt: 'Number' });
  const r1 = rowIo.insertRow(t.id, { [f.id]: 1 });
  const r2 = rowIo.insertRow(t.id, { [f.id]: 2 });
  // Force a coercion failure on the second update by passing invalid email
  const fEmail = schema.addField(t.id, { title: 'e', uidt: 'Email' });
  assertThrows(() => rowIo.batchUpdate(t.id, [
    { id: r1.id, data: { [fEmail.id]: 'good@x.com' } },
    { id: r2.id, data: { [fEmail.id]: 'not-an-email' } },
  ]), 'invalid email');
  // r1's email should NOT be set because the txn rolled back
  const read1 = rowIo.readRow(t.id, r1.id);
  assertEq(read1[fEmail.id], null, 'rollback restored r1');
});

// ── LT1: 1:1 link write/read ──
test('LT1: 1:1 link write + read', () => {
  const { schema, rowIo } = setup();
  const target = schema.createTable({ title: 'T' });
  const src = schema.createTable({ title: 'S' });
  const lf = schema.addField(src.id, { title: 'L', uidt: 'LinkToAnotherRecord', options: { target_table_id: target.id, cardinality: 'one' } });
  const tr = rowIo.insertRow(target.id, {});
  const sr = rowIo.insertRow(src.id, { [lf.id]: [tr.id] });
  const read = rowIo.readRow(src.id, sr.id);
  assertDeepEq(read[lf.id], [tr.id]);
});

// ── LT2: 1:N link ──
test('LT2: 1:N — one source linked to N targets', () => {
  const { schema, rowIo } = setup();
  const target = schema.createTable({ title: 'T' });
  const src = schema.createTable({ title: 'S' });
  const lf = schema.addField(src.id, { title: 'L', uidt: 'Links', options: { target_table_id: target.id } });
  const t1 = rowIo.insertRow(target.id, {});
  const t2 = rowIo.insertRow(target.id, {});
  const t3 = rowIo.insertRow(target.id, {});
  const sr = rowIo.insertRow(src.id, { [lf.id]: [t1.id, t2.id, t3.id] });
  assertDeepEq(rowIo.readRow(src.id, sr.id)[lf.id], [t1.id, t2.id, t3.id]);
});

// ── LT3: N:N — multi-source multi-target ──
test('LT3: N:N — multiple sources point to overlapping targets', () => {
  const { db, schema, rowIo } = setup();
  const target = schema.createTable({ title: 'T' });
  const src = schema.createTable({ title: 'S' });
  const lf = schema.addField(src.id, { title: 'L', uidt: 'Links', options: { target_table_id: target.id } });
  const t1 = rowIo.insertRow(target.id, {});
  const t2 = rowIo.insertRow(target.id, {});
  rowIo.insertRow(src.id, { [lf.id]: [t1.id, t2.id] });
  rowIo.insertRow(src.id, { [lf.id]: [t1.id] });
  // user_links should have 3 rows total
  assertEq(db.prepare('SELECT COUNT(*) AS n FROM user_links WHERE field_id = ?').get(lf.id).n, 3);
});

// ── LT4: bidirectional auto-sync via paired field ──
test('LT4: bidirectional — writing source field updates paired field cache on target', () => {
  const { db, schema, rowIo } = setup();
  const A = schema.createTable({ title: 'A' });
  const B = schema.createTable({ title: 'B' });
  // Create paired fields manually: outgoing on A, mirror on B
  const fA2B = schema.addField(A.id, { title: 'A_to_B', uidt: 'Links', options: { target_table_id: B.id } });
  const fB2A = schema.addField(B.id, { title: 'B_from_A', uidt: 'Links', options: { target_table_id: A.id, paired_field_id: fA2B.id } });
  // Wire fA2B back-pointer to fB2A
  schema.updateField(fA2B.id, { options: { paired_field_id: fB2A.id } });

  const b1 = rowIo.insertRow(B.id, {});
  const a1 = rowIo.insertRow(A.id, { [fA2B.id]: [b1.id] });
  // Reading b1 should now show a1 in its B_from_A cache
  const readB1 = rowIo.readRow(B.id, b1.id);
  assertDeepEq(readB1[fB2A.id], [a1.id], 'paired field cache populated');
});

// ── LT5: delete source row → user_links cleared, target untouched ──
test('LT5: deleting source row clears user_links, target row untouched', () => {
  const { db, schema, rowIo } = setup();
  const target = schema.createTable({ title: 'T' });
  const src = schema.createTable({ title: 'S' });
  const lf = schema.addField(src.id, { title: 'L', uidt: 'Links', options: { target_table_id: target.id } });
  const tr = rowIo.insertRow(target.id, {});
  const sr = rowIo.insertRow(src.id, { [lf.id]: [tr.id] });
  rowIo.deleteRow(src.id, sr.id);
  assertEq(db.prepare('SELECT COUNT(*) AS n FROM user_links WHERE source_row_id = ?').get(sr.id).n, 0);
  assert(rowIo.readRow(target.id, tr.id), 'target survives');
});

// ── LT6: delete target row → user_links cleared + source cache rebuilt ──
test('LT6: deleting target row clears user_links and rebuilds source cache', () => {
  const { db, schema, rowIo } = setup();
  const target = schema.createTable({ title: 'T' });
  const src = schema.createTable({ title: 'S' });
  const lf = schema.addField(src.id, { title: 'L', uidt: 'Links', options: { target_table_id: target.id } });
  const t1 = rowIo.insertRow(target.id, {});
  const t2 = rowIo.insertRow(target.id, {});
  const sr = rowIo.insertRow(src.id, { [lf.id]: [t1.id, t2.id] });
  rowIo.deleteRow(target.id, t1.id);
  // source cache should now be just [t2]
  const read = rowIo.readRow(src.id, sr.id);
  assertDeepEq(read[lf.id], [t2.id]);
});

// ── LT10: delete source row in bidirectional setup → paired cache rebuilt on target ──
test('LT10: bidirectional + delete source → reverse cache rebuilt', () => {
  const { schema, rowIo } = setup();
  const A = schema.createTable({ title: 'A' });
  const B = schema.createTable({ title: 'B' });
  const fA2B = schema.addField(A.id, { title: 'A_to_B', uidt: 'Links', options: { target_table_id: B.id } });
  const fB2A = schema.addField(B.id, { title: 'B_from_A', uidt: 'Links', options: { target_table_id: A.id, paired_field_id: fA2B.id } });
  schema.updateField(fA2B.id, { options: { paired_field_id: fB2A.id } });
  const b1 = rowIo.insertRow(B.id, {});
  const a1 = rowIo.insertRow(A.id, { [fA2B.id]: [b1.id] });
  rowIo.deleteRow(A.id, a1.id);
  const readB1 = rowIo.readRow(B.id, b1.id);
  assertEq(readB1[fB2A.id], null, 'reverse cache cleared after source deleted');
});

// ── LT11: dropField clears user_links for that field ──
test('LT11: dropField clears all user_links for that field', () => {
  const { db, schema, rowIo } = setup();
  const target = schema.createTable({ title: 'T' });
  const src = schema.createTable({ title: 'S' });
  const lf = schema.addField(src.id, { title: 'L', uidt: 'Links', options: { target_table_id: target.id } });
  const tr = rowIo.insertRow(target.id, {});
  rowIo.insertRow(src.id, { [lf.id]: [tr.id] });
  schema.dropField(lf.id);
  assertEq(db.prepare('SELECT COUNT(*) AS n FROM user_links WHERE field_id = ?').get(lf.id).n, 0);
});

// ── Cardinality: 'one' rejects multiple targets ──
test('Cardinality one rejects multi-target write', () => {
  const { schema, rowIo } = setup();
  const target = schema.createTable({ title: 'T' });
  const src = schema.createTable({ title: 'S' });
  const lf = schema.addField(src.id, { title: 'L', uidt: 'LinkToAnotherRecord', options: { target_table_id: target.id, cardinality: 'one' } });
  const t1 = rowIo.insertRow(target.id, {});
  const t2 = rowIo.insertRow(target.id, {});
  assertThrows(() => rowIo.insertRow(src.id, { [lf.id]: [t1.id, t2.id] }), 'CARDINALITY_VIOLATION');
});

console.log(`\n[P4.1.4 + P4.1.6] ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
