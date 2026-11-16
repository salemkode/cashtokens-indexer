import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { backupDatabase, restoreDatabase, validateBackup } from '../src/backup.js';
import { acquireWriter, clearDeadWriter } from '../src/ownership.js';
import { TokenStore } from '../src/store.js';
import { block, id, output, tx } from './fixtures.js';

test('online backup includes committed WAL and restores to a new private database without overwriting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blaze-backup-'));
  const original = new TokenStore({ path: join(dir, 'live.sqlite'), network: 'regtest', startHeight: 0 });
  try {
    original.applyBlock(block(0, [tx(1, [output(id(100), '9007199254740993')])]));
    const backup = join(dir, 'backup.sqlite');
    await backupDatabase(join(dir, 'live.sqlite'), backup);
    original.applyBlock(block(1, [tx(2, [output(id(100), '9007199254740990')], [{ txid: id(1), vout: 0 }])]));
    assert.equal(validateBackup(backup).schema_version, '4');
    assert.equal(statSync(backup).mode & 0o777, 0o600);
    const restoredPath = join(dir, 'restored.sqlite');
    await restoreDatabase(backup, restoredPath);
    const restored = new TokenStore({ path: restoredPath, network: 'regtest', startHeight: 0 });
    try {
      assert.equal(restored.tip()?.height, 0);
      assert.equal(restored.category(id(100))?.fungible_supply, '9007199254740993');
      restored.applyBlock(block(1, [tx(3, [], [{ txid: id(1), vout: 0 }])]));
      assert.equal(restored.category(id(100))?.fungible_supply, '0');
      restored.rollbackTip();
      assert.equal(restored.category(id(100))?.fungible_supply, '9007199254740993');
    } finally { restored.close(); }
    await assert.rejects(backupDatabase(join(dir, 'live.sqlite'), backup), /unused destination/);
    await assert.rejects(restoreDatabase(backup, restoredPath), /new destination/);
    assert.equal(original.category(id(100))?.fungible_supply, '9007199254740990');
  } finally { original.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('writer ownership rejects concurrent service and recovery cannot clear a live lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blaze-owner-'));
  try {
    const path = join(dir, 'live.sqlite');
    const release = acquireWriter(path);
    assert.throws(() => acquireWriter(path), /writer lock/);
    assert.throws(() => clearDeadWriter(path), /process is alive/);
    release();
    const again = acquireWriter(path);
    again();
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    assert.equal(child.status, 0);
    writeFileSync(`${path}.writer-lock`, JSON.stringify({ pid: child.pid, nonce: randomUUID(), created_at: new Date().toISOString() }));
    assert.equal(clearDeadWriter(path).cleared, true);
    const recovered = acquireWriter(path);
    recovered();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('corrupt backups are rejected before creating a restore destination', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blaze-bad-backup-'));
  try {
    const path = join(dir, 'bad.sqlite');
    writeFileSync(path, 'not sqlite');
    await assert.rejects(restoreDatabase(path, join(dir, 'new.sqlite')));
    assert.throws(() => statSync(join(dir, 'new.sqlite')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
