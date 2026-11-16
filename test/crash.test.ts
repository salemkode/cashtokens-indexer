import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { TokenStore } from '../src/store.js';
import { block, tx, output, id } from './fixtures.js';

test('SIGKILL during SQL output insertion recovers only the last committed block and exact materialized balances', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'blaze-midcommit-'));
  const path = join(directory, 'index.sqlite');
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', 'test/helpers/crash-writer.ts', path], { stdio: 'ignore' });
    const [code, signal] = await once(child, 'exit');
    assert.equal(code, null);
    assert.equal(signal, 'SIGKILL');
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM blocks').get()?.count, 1);
      assert.equal(raw.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
      raw.exec('DROP TRIGGER fixture_crash_during_block');
    } finally { raw.close(); }
    const recovered = new TokenStore({ path, network: 'regtest', startHeight: 0 });
    try {
      assert.equal(recovered.tip()?.height, 0);
      assert.equal(recovered.category(id(100))?.fungible_supply, '100');
      assert.equal(recovered.holders(id(100))[0]?.fungible_token_amount, '100');
      assert.equal(recovered.history(id(100)).length, 1);
      assert.deepEqual(recovered.db.prepare('PRAGMA foreign_key_check').all(), []);
      recovered.applyBlock(block(1, [tx(2, [output(id(100), '90')], [{ txid: id(1), vout: 0 }])]));
      assert.equal(recovered.category(id(100))?.fungible_supply, '90');
    } finally { recovered.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('SQLite disk-full during a block rolls back its writes and leaves a usable checkpoint', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blaze-sqlite-full-'));
  const path = join(directory, 'index.sqlite');
  const store = new TokenStore({ path, network: 'regtest', startHeight: 0 });
  try {
    store.applyBlock(block(0, [tx(1, [output()])]));
    const pages = Number(store.db.prepare('PRAGMA page_count').get()?.page_count);
    store.db.exec(`PRAGMA max_page_count = ${pages + 1}`);
    assert.throws(() => store.applyBlock(block(1, [tx(2, Array.from({ length: 2000 }, () => output()),
      [{ txid: id(1), vout: 0 }])])), /no partial block/);
    assert.equal(store.db.isTransaction, false);
    assert.equal(store.tip()?.height, 0);
    assert.equal(store.category(id(100))?.fungible_supply, '100');
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    store.db.exec('PRAGMA max_page_count = 1000000');
    store.applyBlock(block(1, [tx(3, [output(id(100), '90')], [{ txid: id(1), vout: 0 }])]));
    assert.equal(store.category(id(100))?.fungible_supply, '90');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
