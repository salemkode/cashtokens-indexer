import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TokenStore } from '../src/store.js';
import { alice, block, id, output, tx } from './fixtures.js';

const columns = {
  blocks: ['hash', 'previous_hash'], transactions: ['txid'],
  outputs: ['txid', 'category', 'commitment', 'script', 'spent_by'],
  movements: ['txid', 'category'], token_geneses: ['category', 'txid'],
  category_first_seen: ['category', 'txid'], category_totals: ['category'], holder_balances: ['category', 'script'],
};
// Reconstruct the actual v3 layout: same tables/triggers/FKs, TEXT keys, no identity tables/meta.
function legacyDatabase(path: string) {
  const original = new TokenStore({ path, network: 'regtest', startHeight: 0 });
  original.applyBlock(block(0, [tx(100, [{ n: 0, value: 0.1, scriptPubKey: { hex: alice } }])]));
  original.applyBlock(block(1, [tx(101, [output(id(100), '9007199254740993', alice,
    { capability: 'mutable', commitment: '' })], [{ txid: id(100), vout: 0 }])]));
  original.applyBlock(block(2, [tx(102, [output(id(100), '9007199254740990')], [{ txid: id(101), vout: 0 }])]));
  const expected = { category: original.category(id(100)), history: original.history(id(100)), outputs: original.listOutputs() };
  original.close();
  const db = new DatabaseSync(path);
  db.function('token_add', (left, right) => (BigInt(String(left)) + BigInt(String(right))).toString());
  db.exec('PRAGMA foreign_keys = OFF; BEGIN');
  for (const [table, names] of Object.entries(columns)) {
    for (const name of names) db.exec(`UPDATE ${table} SET ${name} = lower(hex(${name})) WHERE typeof(${name}) = 'blob'`);
  }
  db.exec(`DROP TABLE authchain_steps; DROP TABLE bcmr_publications; DROP TABLE identity_edges; DROP TABLE identity_nodes; DROP TABLE authchain_resolutions;
    ALTER TABLE movements DROP COLUMN fungible_issued; ALTER TABLE movements DROP COLUMN fungible_burned;
    DELETE FROM meta WHERE key IN ('undo_floor', 'authchain_scan_start', 'identity_index_version', 'identity_scan_start', 'authchain_bases', 'activity_index_version', 'activity_detail_start');
    UPDATE meta SET value = '3' WHERE key = 'schema_version'; COMMIT`);
  db.close();
  return expected;
}

test('schema 3 migrates binary keys atomically, retains exact state/history, and marks missing authchain coverage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blaze-migration-'));
  try {
    const path = join(dir, 'index.sqlite');
    const expected = legacyDatabase(path);
    const store = new TokenStore({ path, network: 'regtest', startHeight: 0 });
    try {
      assert.equal(store.status().schema_version, 4);
      assert.deepEqual(store.category(id(100)), expected.category);
      assert.deepEqual(store.history(id(100)), expected.history);
      assert.deepEqual(store.listOutputs(), expected.outputs);
      assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(store.db.prepare('SELECT typeof(txid) AS kind, length(txid) AS bytes FROM transactions LIMIT 1').get()?.kind, 'blob');
      assert.equal(store.db.prepare('SELECT length(txid) AS bytes FROM transactions LIMIT 1').get()?.bytes, 32);
      assert.equal(store.authchain(id(100)).status, 'incomplete');
      assert.equal(store.status().authchain_scan_start, 3);
      store.rollbackTip();
      assert.equal(store.category(id(100))?.fungible_supply, '9007199254740993');
      assert.equal(store.listOutputs()[0]?.nonfungible_token_commitment, '\\x');
    } finally { store.close(); }
    const reopened = new TokenStore({ path, network: 'regtest', startHeight: 0 });
    assert.equal(reopened.status().authchain_scan_start, 3);
    reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed legacy identifiers abort the whole migration and preserve version and original key types', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blaze-migration-invalid-'));
  try {
    const path = join(dir, 'index.sqlite');
    legacyDatabase(path);
    const db = new DatabaseSync(path);
    db.exec("UPDATE holder_balances SET script = 'not-hex'");
    db.close();
    assert.throws(() => new TokenStore({ path, network: 'regtest', startHeight: 0 }), /migration failed/);
    const check = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(check.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value, '3');
      assert.equal(check.prepare('SELECT typeof(hash) AS kind FROM blocks LIMIT 1').get()?.kind, 'text');
      assert.equal(check.prepare('SELECT typeof(txid) AS kind FROM outputs LIMIT 1').get()?.kind, 'text');
    } finally { check.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('finite undo retention deletes old spent outputs while retaining burns, genesis and exact live balances across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blaze-retention-'));
  const path = join(dir, 'index.sqlite');
  try {
    const store = new TokenStore({ path, network: 'regtest', startHeight: 0, undoDepth: 2 });
    store.applyBlock(block(0, [tx(100, [{ n: 0, value: 0.1, scriptPubKey: { hex: alice } }])]));
    store.applyBlock(block(1, [tx(101, [output(id(100), '9007199254740993')], [{ txid: id(100), vout: 0 }])]));
    store.applyBlock(block(2, [tx(102, [output(id(100), '9007199254740990'), output(id(100), '3', '6a')], [{ txid: id(101), vout: 0 }])]));
    for (const height of [3, 4]) store.applyBlock(block(height, []));
    assert.equal(store.status().undo_floor, 2);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM outputs WHERE spent_by IS NOT NULL OR unspendable = 1').get()?.count, 0);
    assert.equal(store.history(id(100)).length, 2);
    assert.equal(store.history(id(100))[0]?.fungible_delta, '-3');
    assert.equal(store.category(id(100))?.genesis_txid, id(101));
    assert.equal(store.holders(id(100))[0]?.fungible_token_amount, '9007199254740990');
    store.close();
    const reopened = new TokenStore({ path, network: 'regtest', startHeight: 0, undoDepth: 100 });
    try {
      // Increasing retention cannot recreate rows already pruned.
      assert.equal(reopened.status().undo_floor, 2);
      reopened.rollbackTip();
      reopened.rollbackTip();
      assert.throws(() => reopened.rollbackTip(), /exceeds retained undo/);
      assert.equal(reopened.tip()?.height, 2);
      assert.equal(reopened.category(id(100))?.fungible_supply, '9007199254740990');
      assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CTOR spent outputs remain recoverable throughout the entire retained rollback window', () => {
  const store = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 0, undoDepth: 2 });
  try {
    store.applyBlock(block(0, [tx(1, [output()])]));
    store.applyBlock(block(1, []));
    store.applyBlock(block(2, []));
    store.applyBlock(block(3, [
      tx(3, [output(id(100), '80')], [{ txid: id(2), vout: 0 }]),
      tx(2, [output(id(100), '90')], [{ txid: id(1), vout: 0 }]),
    ]));
    store.applyBlock(block(4, []));
    store.rollbackTip();
    store.rollbackTip();
    assert.equal(store.category(id(100))?.fungible_supply, '100');
    assert.equal(store.listOutputs()[0]?.transaction_hash, `\\x${id(1)}`);
  } finally { store.close(); }
});
