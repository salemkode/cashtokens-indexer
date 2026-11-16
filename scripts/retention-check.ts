import { writeReport } from './reports.js';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { TokenStore } from '../src/store.js';

function id(value: number) { return value.toString(16).padStart(64, '0'); }
const directory = mkdtempSync(join(tmpdir(), 'blaze-retention-measure-'));
const path = join(directory, 'index.sqlite');
const depth = 32;
const blocks = 2000;
const store = new TokenStore({ path, network: 'regtest', startHeight: 0, undoDepth: depth });
const started = performance.now();
const highWater = { wal_bytes: 0, rss_bytes: 0 };
try {
  for (const height of Array.from({ length: blocks }, (_, index) => index)) {
    store.applyBlock({ height, hash: id(100000 + height), ...(height === 0 ? {} : { previousblockhash: id(99999 + height) }),
      time: 1700000000 + height, tx: [{ txid: id(height + 1),
        vin: height === 0 ? [{ coinbase: '00' }] : [{ txid: id(height), vout: 0 }],
        vout: [{ n: 0, value: 0.0001, scriptPubKey: { hex: '51' }, tokenData: { category: id(999999), amount: '9007199254740993',
          nft: { capability: 'mutable', commitment: height.toString(16).padStart(4, '0') } } }] }] });
    highWater.wal_bytes = Math.max(highWater.wal_bytes, statSync(`${path}-wal`).size);
    highWater.rss_bytes = Math.max(highWater.rss_bytes, process.memoryUsage().rss);
  }
  const outputs = Number(store.db.prepare('SELECT COUNT(*) AS count FROM outputs').get()?.count);
  const history = Number(store.db.prepare('SELECT COUNT(*) AS count FROM movements').get()?.count);
  assert.ok(outputs <= depth + 1);
  assert.equal(history, blocks);
  assert.equal(store.category(id(999999))?.fungible_supply, '9007199254740993');
  const sourceHash = createHash('sha256');
  for (const name of readdirSync('src').filter(name => /\.(ts|json)$/.test(name)).sort()) sourceHash.update(name).update(readFileSync(join('src', name)));
  const recorded = { runtime_source_sha256: sourceHash.digest('hex'), observed_at: new Date().toISOString(), node: process.version,
    scope: 'synthetic disk-backed SQLite mutable-NFT/FT churn only; not consensus, live Chipnet, chain capacity or sustained production throughput',
    blocks, undo_depth: depth, retained_output_rows: outputs, retained_history_rows: history,
    live_utxos: store.listOutputs().length, sqlite_bytes: statSync(path).size,
    wal_high_water_bytes: highWater.wal_bytes, process_rss_high_water_bytes: highWater.rss_bytes,
    elapsed_ms: performance.now() - started, undo_floor: store.status().undo_floor };
  for (const _ of Array.from({ length: depth })) store.rollbackTip();
  assert.throws(() => store.rollbackTip(), /exceeds retained undo/);
  assert.equal(store.category(id(999999))?.fungible_supply, '9007199254740993');
  mkdirSync('.build/reports', { recursive: true });
  writeReport('retention-check', { ...recorded, full_retained_window_rollback: 'passed', deep_rollback: 'refused' });
  console.log(JSON.stringify(recorded));
} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
