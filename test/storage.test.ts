import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectStorage } from '../src/storage.js';
import { TokenStore } from '../src/store.js';
import { alice, block, id, output, tx } from './fixtures.js';

function digest(path: string) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function populate(path: string) {
  const store = new TokenStore({ path, network: 'regtest', startHeight: 0 });
  store.applyBlock(block(0, [tx(1, [output(), output(id(100), '0', alice, { capability: 'none', commitment: '' })])]));
  store.applyBlock(block(1, [tx(2, [output(id(100), '90'), output(id(100), '10', '6a')], [{ txid: id(1), vout: 0 }])]));
  return store;
}

test('storage inspection rejects a missing file without creating files or directories', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blaze-storage-missing-'));
  try {
    const path = join(directory, 'absent', 'index.sqlite');
    assert.throws(() => inspectStorage({ path }), /does not exist/);
    assert.equal(existsSync(path), false);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('default storage report reads page metadata without table scans or modifying a quiet database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blaze-storage-quiet-'));
  try {
    const path = join(directory, 'index.sqlite');
    populate(path).close();
    const before = { hash: digest(path), size: statSync(path).size, files: readdirSync(directory).sort() };
    const report = inspectStorage({ path });
    assert.equal(report.details.status, 'not_requested');
    assert.equal(report.metadata.network, 'regtest');
    assert.equal(report.metadata.schema_version, '4');
    assert.equal(report.indexed_range.first?.height, 0);
    assert.equal(report.indexed_range.tip?.height, 1);
    assert.equal(report.sqlite_pages.logical_database_bytes, report.sqlite_pages.page_count * report.sqlite_pages.page_size_bytes);
    assert.ok(report.sqlite_pages.used_page_bytes > 0);
    assert.equal(report.files[0]?.apparent_bytes, before.size);
    assert.equal(report.observed_file_bytes, report.files.reduce((total, file) => total + file.apparent_bytes, 0));
    assert.equal(digest(path), before.hash);
    assert.equal(statSync(path).size, before.size);
    // SQLite can create locking sidecars for WAL-mode readers. They must not change database content.
    assert.ok(readdirSync(directory).every(name => name === 'index.sqlite' || name === 'index.sqlite-wal' || name === 'index.sqlite-shm'));
    assert.ok(before.files.includes('index.sqlite'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('detailed report distinguishes retained spent outputs, live state, and index pages', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blaze-storage-details-'));
  try {
    const path = join(directory, 'index.sqlite');
    populate(path).close();
    const report = inspectStorage({ path, details: true });
    assert.ok(report.details.status === 'collected');
    assert.deepEqual(report.details.outputs, { total: 4, live: 2, spent: 1, unspendable: 1 });
    assert.equal(report.details.table_rows.outputs, 4);
    assert.equal(report.details.table_rows.blocks, 2);
    assert.equal(report.details.table_rows.transactions, 2);
    assert.equal(report.details.table_rows.holder_balances, 1);
    const pages = report.details.object_pages;
    if (pages.status === 'available') {
      assert.ok(pages.objects.some(object => object.name === 'outputs' && object.kind === 'table'));
      assert.ok(pages.objects.some(object => object.name === 'outputs_category' && object.kind === 'index'));
      assert.ok(pages.objects.every(object => object.payload_bytes + object.unused_bytes <= object.bytes));
      assert.ok(pages.objects.reduce((total, object) => total + object.bytes, 0) <= report.sqlite_pages.logical_database_bytes);
    } else {
      assert.match(pages.reason, /dbstat/);
    }
    assert.ok(statSync(path).size < 1000000, 'fixture must remain below one megabyte');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('storage reporting does not checkpoint or truncate an active writer WAL', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blaze-storage-wal-'));
  const path = join(directory, 'index.sqlite');
  const store = populate(path);
  try {
    const before = { main: digest(path), wal: digest(`${path}-wal`), walSize: statSync(`${path}-wal`).size };
    const report = inspectStorage({ path, details: true });
    assert.ok(report.details.status === 'collected');
    assert.equal(report.details.table_rows.outputs, 4);
    assert.equal(report.files.find(file => file.role === 'wal')?.apparent_bytes, before.walSize);
    assert.equal(digest(path), before.main);
    assert.equal(digest(`${path}-wal`), before.wal);
    assert.equal(statSync(`${path}-wal`).size, before.walSize);
    assert.equal(store.category(id(100))?.fungible_supply, '90');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('unrelated databases are rejected without creating Blaze tables', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blaze-storage-other-'));
  try {
    const path = join(directory, 'other.sqlite');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE unrelated (value TEXT)');
    db.close();
    const before = digest(path);
    assert.throws(() => inspectStorage({ path }), /not a supported Blaze/);
    assert.equal(digest(path), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
