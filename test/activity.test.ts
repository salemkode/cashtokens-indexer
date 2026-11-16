import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { activityEnvelope } from '../src/activity-contract.js';
import { DatabaseSync } from 'node:sqlite';
import { TokenStore } from '../src/store.js';
import { createApi } from '../src/api.js';
import { block, tx, output, id, alice, bob } from './fixtures.js';

function plain() { return { n: 0, value: 0.000007, scriptPubKey: { hex: bob } }; }
function root() { return tx(100, [plain()]); }
function genesis() { return tx(101, [output(id(100), '9007199254740993', alice, { capability: 'mutable', commitment: '' })], [{ txid: id(100), vout: 0 }]); }

test('global activity groups mixed categories, includes complete input-only burns, preserves exact gross/net deltas and snapshot order', async t => {
  const store = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 0, undoDepth: 2 });
  const api = await createApi({ store, corsOrigins: [] });
  t.after(async () => { await api.close(); store.close(); });
  store.applyBlock(block(0, [root(), tx(200, [plain()])]));
  store.applyBlock(block(1, [genesis()]));
  store.applyBlock(block(2, [tx(201, [output(id(200), '50')], [{ txid: id(200), vout: 0 }])]));
  store.applyBlock(block(3, [tx(300, [output(id(100), '9007199254740990', alice, { capability: 'mutable', commitment: 'aa' }), output(id(200), '40')],
    [{ txid: id(101), vout: 0 }, { txid: id(201), vout: 0 }])]));
  store.applyBlock(block(4, [tx(400, [plain()], [{ txid: id(300), vout: 0 }])]));
  store.applyBlock(block(5, [tx(500, [plain(), { ...plain(), scriptPubKey: { hex: `6a0442434d5220${'aa'.repeat(32)}` } }], [{ txid: id(400), vout: 0 }])]));
  const first = await api.inject('/v1/activity?limit=2');
  assert.equal(first.statusCode, 200);
  const body = first.json();
  assert.equal(body.network, 'regtest'); assert.equal(body.confirmed_only, true); assert.equal(body.indexed_height, 5);
  assert.equal(body.snapshot.hash, id(1005)); assert.equal(body.metadata_only_authchain_events, 'excluded');
  assert.deepEqual(body.data.map((row: { txid: string }) => row.txid), [id(400), id(300)]);
  assert.equal(body.data[0].categories[0].fungible_delta, '-9007199254740990');
  assert.equal(body.data[0].categories[0].fungible_burned, '9007199254740990');
  assert.equal(body.data[0].categories[0].fungible_issued, '0');
  assert.equal(body.data[0].categories[0].nft_delta, -1);
  assert.deepEqual(body.data[1].categories.map((row: { category: string }) => row.category), [id(100), id(200)]);
  assert.deepEqual(body.data[1].categories.map((row: { fungible_burned: string }) => row.fungible_burned), ['3', '10']);
  const second = (await api.inject(`/v1/activity?limit=2&offset=2&snapshot_hash=${body.snapshot.hash}`)).json();
  assert.deepEqual(second.data.map((row: { txid: string }) => row.txid), [id(201), id(101)]);
  assert.equal(second.data[1].categories[0].fungible_issued, '9007199254740993');
  // Old spent payloads were pruned, but retained compact history still answers all four events.
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM outputs WHERE spent_by IS NOT NULL').get()?.count, 1);
  assert.equal((await api.inject('/v1/activity')).json().data.length, 4);
  store.rollbackTip();
  assert.equal((await api.inject(`/v1/activity?snapshot_hash=${body.snapshot.hash}`)).statusCode, 409);
  store.rollbackTip();
  assert.equal((await api.inject('/v1/activity')).json().data[0].txid, id(300));
  assert.equal(store.category(id(100))?.fungible_supply, '9007199254740990');
  for (const query of ['limit=101', 'limit=0', 'offset=-1', 'offset=10000001']) assert.equal((await api.inject(`/v1/activity?${query}`)).statusCode, 400);
});

test('activity gross issuance/burns include unspendable genesis outputs while partial scans never fabricate issuance detail', async t => {
  const store = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 0 });
  const api = await createApi({ store, corsOrigins: [] });
  t.after(async () => { await api.close(); store.close(); });
  store.applyBlock(block(0, [root()]));
  store.applyBlock(block(1, [tx(101, [output(id(100), '90'), output(id(100), '10', '6a')], [{ txid: id(100), vout: 0 }])]));
  const created = (await api.inject('/v1/activity')).json().data[0].categories[0];
  assert.equal(created.fungible_delta, '90'); assert.equal(created.fungible_issued, '100'); assert.equal(created.fungible_burned, '10');
  const partial = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 2 });
  partial.setAnchor(1, id(1001));
  partial.applyBlock(block(2, [tx(2, [output(id(100), '50')])]));
  const app = await createApi({ store: partial, corsOrigins: [] });
  t.after(async () => { await app.close(); partial.close(); });
  const body = (await app.inject('/v1/activity')).json();
  assert.equal(body.coverage.token_state.status, 'incomplete');
  assert.equal(body.coverage.start_height, 2);
  assert.equal(body.data[0].categories[0].category_history_complete, false);
  assert.equal(body.data[0].categories[0].fungible_issued, null);
  assert.equal(body.data[0].categories[0].fungible_burned, null);
});

test('activity migration retains old signed history with explicit unknown gross detail, then records exact new burns', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'blaze-activity-upgrade-'));
  const path = join(directory, 'index.sqlite');
  const original = new TokenStore({ path, network: 'regtest', startHeight: 0 });
  original.applyBlock(block(0, [root()])); original.applyBlock(block(1, [genesis()])); original.close();
  const old = new DatabaseSync(path);
  old.exec(`DELETE FROM meta WHERE key IN ('activity_index_version','activity_detail_start');
    ALTER TABLE movements DROP COLUMN fungible_issued; ALTER TABLE movements DROP COLUMN fungible_burned;`);
  old.close();
  const store = new TokenStore({ path, network: 'regtest', startHeight: 0 });
  const api = await createApi({ store, corsOrigins: [] });
  t.after(async () => { await api.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const oldRow = (await api.inject('/v1/activity')).json();
  assert.equal(oldRow.data[0].categories[0].fungible_delta, '9007199254740993');
  assert.equal(oldRow.data[0].categories[0].fungible_issued, null);
  assert.equal(oldRow.coverage.gross_fungible_details_start, 2);
  store.applyBlock(block(2, [tx(102, [plain()], [{ txid: id(101), vout: 0 }])]));
  const newRow = (await api.inject('/v1/activity')).json().data[0];
  assert.equal(newRow.categories[0].fungible_burned, '9007199254740993');
  assert.equal(newRow.categories[0].gross_fungible_details_complete, true);
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('activity machine schema matches the server boundary', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/activity-api-v1.schema.json', import.meta.url), 'utf8')),
    z.toJSONSchema(activityEnvelope, { io: 'input' }));
});
