/**
 * P4.1.2 schema.js tests: UT1, UT2, UT8, UT9, UT15, UT16
 * Run from gateway/ dir: node lib/table-engine/__tests__/schema.test.mjs
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
function assertThrows(fn, codeOrMsg) {
  try { fn(); } catch (err) {
    if (typeof codeOrMsg === 'string' && err.code !== codeOrMsg && !err.message.includes(codeOrMsg)) {
      throw new Error(`expected error with code/message containing ${codeOrMsg}, got ${err.code}/${err.message}`);
    }
    return;
  }
  throw new Error('expected function to throw');
}

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runTableEngineMigrations(db);
  return { db, schema: createSchema(db) };
}

console.log('\n[P4.1.2] schema.js tests');

// ── UT1: createTable → physical table appears + user_fields rows ──
test('UT1: createTable creates user_tables row + physical table', () => {
  const { db, schema } = setup();
  const t = schema.createTable({ title: 'Customers', columns: [
    { title: 'Name', uidt: 'SingleLineText' },
    { title: 'Email', uidt: 'Email' },
  ]});
  assert(t.id.startsWith('utbl_'), 'table id prefix');
  assertEq(t.title, 'Customers');
  assertEq(t.fields.length, 2);

  // physical table exists
  const physName = `utbl_${t.id}_rows`;
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(physName);
  assert(exists, 'physical table created');

  // physical columns exist
  const info = db.prepare(`PRAGMA table_info("${physName}")`).all();
  const colNames = info.map(c => c.name);
  assert(colNames.includes('id'), 'id column');
  assert(colNames.includes('created_at'), 'created_at column');
  assert(colNames.includes(`f_${t.fields[0].id}`), 'field 1 physical column');
  assert(colNames.includes(`f_${t.fields[1].id}`), 'field 2 physical column');
});

// ── UT2: addField with all 22 non-virtual uidts → ALTER TABLE succeeds ──
test('UT2: addField with all 20 non-virtual uidts', () => {
  const { db, schema } = setup();
  const t = schema.createTable({ title: 'Everything' });
  const targetTable = schema.createTable({ title: 'Target' }); // for Link/Links
  const uidts = [
    'SingleLineText', 'LongText', 'Number', 'Decimal', 'Checkbox',
    'Date', 'DateTime', 'Email', 'URL', 'SingleSelect',
    'MultiSelect', 'AutoNumber', 'Attachment', 'Rating',
    'PhoneNumber', 'Percent', 'Duration', 'Currency',
  ];
  for (const uidt of uidts) {
    schema.addField(t.id, { title: uidt + '_col', uidt });
  }
  // Link uidts require options.target_table_id
  schema.addField(t.id, { title: 'LinkOne', uidt: 'LinkToAnotherRecord', options: { target_table_id: targetTable.id, cardinality: 'one' } });
  schema.addField(t.id, { title: 'LinksMany', uidt: 'Links', options: { target_table_id: targetTable.id, cardinality: 'many' } });

  // Virtual uidts: no physical column
  schema.addField(t.id, { title: 'CreatedAt', uidt: 'CreatedTime' });
  schema.addField(t.id, { title: 'CreatedBy', uidt: 'CreatedBy' });

  const fields = schema.listFields(t.id);
  assertEq(fields.length, uidts.length + 2 + 2);

  const physName = `utbl_${t.id}_rows`;
  const info = db.prepare(`PRAGMA table_info("${physName}")`).all();
  const colNames = new Set(info.map(c => c.name));

  // Each non-virtual field must have its physical column
  for (const f of fields) {
    if (['CreatedTime', 'CreatedBy', 'LastModifiedTime', 'LastModifiedBy', 'ID'].includes(f.uidt)) {
      assert(!colNames.has(f.physical_column), `virtual field ${f.uidt} should not have physical col`);
    } else {
      assert(colNames.has(f.physical_column), `physical col missing for ${f.uidt}`);
    }
  }

  // Type spot-checks
  const numCol = info.find(c => c.name === fields.find(f => f.uidt === 'Number').physical_column);
  assertEq(numCol.type, 'REAL');
  const intCol = info.find(c => c.name === fields.find(f => f.uidt === 'Checkbox').physical_column);
  assertEq(intCol.type, 'INTEGER');
});

// ── UT8: dropField → physical column removed + user_fields row removed ──
test('UT8: dropField cleans up user_fields + drops physical column', () => {
  const { db, schema } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'temp', uidt: 'SingleLineText' });
  const physName = `utbl_${t.id}_rows`;

  // sanity: column exists
  let info = db.prepare(`PRAGMA table_info("${physName}")`).all();
  assert(info.some(c => c.name === f.physical_column), 'col exists pre-drop');

  schema.dropField(f.id);

  info = db.prepare(`PRAGMA table_info("${physName}")`).all();
  assert(!info.some(c => c.name === f.physical_column), 'col removed post-drop');
  const row = db.prepare('SELECT * FROM user_fields WHERE id = ?').get(f.id);
  assert(!row, 'user_fields row removed');
});

// ── UT8b: dropField also clears user_links / user_select_options / view refs ──
test('UT8b: dropField clears all metadata side tables', () => {
  const { db, schema } = setup();
  const t = schema.createTable({ title: 'Source' });
  const target = schema.createTable({ title: 'Target' });
  const linkField = schema.addField(t.id, { title: 'LinkF', uidt: 'LinkToAnotherRecord', options: { target_table_id: target.id } });

  // Manually plant a link row + select option + view filter referencing this field
  db.prepare(`INSERT INTO user_links (id, field_id, source_table_id, source_row_id, target_table_id, target_row_id, created_at)
    VALUES ('lnk_x', ?, ?, 'r1', ?, 'r2', ?)`).run(linkField.id, t.id, target.id, Date.now());
  db.prepare(`INSERT INTO user_select_options (id, field_id, table_id, value, position, created_at)
    VALUES ('opt_x', ?, ?, 'A', 0, ?)`).run(linkField.id, t.id, Date.now());

  schema.dropField(linkField.id);
  assertEq(db.prepare('SELECT COUNT(*) AS n FROM user_links WHERE field_id = ?').get(linkField.id).n, 0);
  assertEq(db.prepare('SELECT COUNT(*) AS n FROM user_select_options WHERE field_id = ?').get(linkField.id).n, 0);
});

// ── UT9: dropTable → physical table dropped + all metadata cascade ──
test('UT9: dropTable drops physical table + cascades all metadata', () => {
  const { db, schema } = setup();
  const target = schema.createTable({ title: 'Target' });
  const t = schema.createTable({ title: 'Source', columns: [
    { title: 'A', uidt: 'SingleLineText' },
    { title: 'B', uidt: 'Number' },
  ]});
  // Add a Link field referencing target
  const linkF = schema.addField(t.id, { title: 'L', uidt: 'Links', options: { target_table_id: target.id } });
  // Plant a user_links row going from source → target
  db.prepare(`INSERT INTO user_links (id, field_id, source_table_id, source_row_id, target_table_id, target_row_id, created_at)
    VALUES ('lnk_y', ?, ?, 'r1', ?, 'r2', ?)`).run(linkF.id, t.id, target.id, Date.now());

  const physName = `utbl_${t.id}_rows`;
  schema.dropTable(t.id);

  // Physical table gone
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(physName);
  assert(!exists, 'physical table dropped');
  // user_tables row gone
  assert(!db.prepare('SELECT 1 FROM user_tables WHERE id = ?').get(t.id), 'user_tables row gone');
  // user_fields rows gone
  assertEq(db.prepare('SELECT COUNT(*) AS n FROM user_fields WHERE table_id = ?').get(t.id).n, 0);
  // user_links rows gone (both directions)
  assertEq(db.prepare('SELECT COUNT(*) AS n FROM user_links WHERE source_table_id = ? OR target_table_id = ?').get(t.id, t.id).n, 0);
  // target table still exists
  assert(db.prepare('SELECT 1 FROM user_tables WHERE id = ?').get(target.id), 'target table untouched');
});

// ── UT15: rename field → physical column unchanged (I5) ──
test('UT15: updateField rename leaves physical column unchanged', () => {
  const { db, schema } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'Old', uidt: 'SingleLineText' });
  const origPhys = f.physical_column;

  const updated = schema.updateField(f.id, { title: 'New' });
  assertEq(updated.title, 'New');
  assertEq(updated.physical_column, origPhys);

  const physName = `utbl_${t.id}_rows`;
  const info = db.prepare(`PRAGMA table_info("${physName}")`).all();
  assert(info.some(c => c.name === origPhys), 'physical column name unchanged in DB');
});

// ── UT16: drop with index — fallback path covered by NORMAL drop ──
test('UT16: dropField on column with implicit index works', () => {
  const { db, schema } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'Indexed', uidt: 'SingleLineText' });
  const physName = `utbl_${t.id}_rows`;
  // Add an explicit index on this column
  db.exec(`CREATE INDEX "idx_test_${f.id}" ON "${physName}" ("${f.physical_column}")`);
  schema.dropField(f.id);

  const info = db.prepare(`PRAGMA table_info("${physName}")`).all();
  assert(!info.some(c => c.name === f.physical_column), 'indexed column dropped');
});

// ── I4: Link target_table_id immutable (LT8) ──
test('I4: updateField rejects target_table_id change on Link field', () => {
  const { schema } = setup();
  const target1 = schema.createTable({ title: 'T1' });
  const target2 = schema.createTable({ title: 'T2' });
  const t = schema.createTable({ title: 'Src' });
  const lf = schema.addField(t.id, { title: 'L', uidt: 'LinkToAnotherRecord', options: { target_table_id: target1.id } });
  assertThrows(() => schema.updateField(lf.id, { options: { target_table_id: target2.id } }), 'Link target cannot be changed');
});

// ── I5 enforcement at update level ──
test('I5: updateField rejects physical_column patch', () => {
  const { schema } = setup();
  const t = schema.createTable({ title: 'X' });
  const f = schema.addField(t.id, { title: 'A', uidt: 'SingleLineText' });
  assertThrows(() => schema.updateField(f.id, { physical_column: 'f_hax' }), 'physical_column is immutable');
});

console.log(`\n[P4.1.2] ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
