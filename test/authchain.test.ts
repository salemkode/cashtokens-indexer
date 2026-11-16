import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { authchainEnvelope } from '../src/authchain-contract.js';
import { createHash } from 'node:crypto';
import { createApi } from '../src/api.js';
import { parsePublication } from '../src/authchain.js';
import { TokenStore } from '../src/store.js';
import { alice, bob, block, id, output, tx } from './fixtures.js';

const digest = createHash('sha256').update('{"identities":{}}').digest('hex');
function push(value: string) { return `${(value.length / 2).toString(16).padStart(2, '0')}${value}`; }
const publication = `6a0442434d5220${digest}${push(Buffer.from('example.org').toString('hex'))}`;
function plain(script = alice) { return { n: 0, value: 0.000008, scriptPubKey: { hex: script } }; }
function seeded() {
  const store = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 0 });
  store.applyBlock(block(0, [tx(100, [plain(), plain(publication)])]));
  store.applyBlock(block(1, [tx(101, [output(id(100), '100')], [{ txid: id(100), vout: 0 }])]));
  return store;
}

test('BCMR output-0 spends track metadata-only updates, inherited publication, and burn; rollback is atomic', async t => {
  const store = seeded();
  const api = await createApi({ store, corsOrigins: [] });
  t.after(async () => { await api.close(); store.close(); });
  const initial = store.authchain(id(100));
  assert.equal(initial.status, 'tracked');
  assert.ok(initial.authhead);
  assert.equal(initial.authhead.txid, id(101));
  assert.equal(initial.authhead.fungible_token_amount, '100');
  assert.equal(initial.latest_publication?.status, 'published');
  assert.equal(initial.latest_publication?.txid, id(100));
  assert.equal(initial.coverage.status, 'complete');
  // Authority moves in input 1, proving it is not a first-input-only traversal.
  store.applyBlock(block(2, [tx(102, [plain(bob)], [{ txid: id(999), vout: 3 }, { txid: id(101), vout: 0 }])]));
  const moved = store.authchain(id(100));
  assert.ok(moved.authhead);
  assert.equal(moved.authhead.txid, id(102));
  assert.equal(moved.authhead.token_category, null);
  assert.equal(moved.authhead.locking_bytecode, bob);
  assert.equal(moved.latest_publication?.txid, id(100));
  assert.equal(store.category(id(100))?.fungible_supply, '0');
  store.applyBlock(block(3, [tx(103, [plain(), plain('6a0442434d5201ff'), plain(publication)], [{ txid: id(102), vout: 0 }])]));
  const invalid = store.authchain(id(100));
  assert.ok('latest_publication' in invalid);
  assert.equal(invalid.latest_publication?.status, 'invalid');
  assert.equal(invalid.latest_publication?.txid, id(103));
  store.applyBlock(block(4, [tx(104, [plain('6a')], [{ txid: id(103), vout: 0 }])]));
  const response = await api.inject(`/v1/tokens/${id(100)}/authchain?limit=1`);
  assert.equal(response.statusCode, 200);
  const data = response.json();
  assert.equal(data.indexed_height, 4);
  assert.equal(data.data.status, 'burned');
  assert.equal(data.data.discovery_only, true);
  assert.equal(data.data.authhead.txid, id(104));
  assert.equal(data.data.revisions.length, 1);
  assert.equal(data.data.revisions[0].previous_txid, id(103));
  assert.equal(data.data.coverage.indexed_tip.hash, id(1004));
  store.rollbackTip();
  store.rollbackTip();
  const restored = store.authchain(id(100));
  assert.ok(restored.authhead);
  assert.equal(restored.authhead.txid, id(102));
  assert.equal(restored.latest_publication?.txid, id(100));
  // A SQL failure after both a token change and identity discovery must roll everything back.
  store.db.exec("CREATE TRIGGER fail_auth BEFORE INSERT ON authchain_steps BEGIN SELECT RAISE(ABORT, 'fixture'); END");
  assert.throws(() => store.applyBlock(block(3, [tx(105, [plain(publication)], [{ txid: id(102), vout: 0 }])])), /no partial/);
  assert.equal(store.tip()?.height, 2);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM bcmr_publications').get()?.count, 1);
});

test('CTOR resolves reversed metadata-only chains and merged identities without indexing ordinary BCH bodies', () => {
  const store = seeded();
  try {
    store.applyBlock(block(2, [tx(200, [plain()]), tx(201, [output(id(200), '1')], [{ txid: id(200), vout: 0 }])]));
    store.applyBlock(block(3, [
      tx(302, [plain(), plain(publication)], [{ txid: id(301), vout: 0 }]),
      tx(301, [plain()], [{ txid: id(101), vout: 0 }, { txid: id(201), vout: 0 }]),
    ]));
    for (const category of [id(100), id(200)]) {
      const result = store.authchain(category);
      assert.ok(result.authhead);
      assert.equal(result.authhead.txid, id(302));
      assert.equal(result.authchain_length, 3);
      assert.equal(result.latest_publication?.txid, id(302));
      assert.deepEqual(result.revisions.map(revision => revision.txid), [id(302), id(301), category === id(100) ? id(101) : id(201)]);
    }
    // 302 is purely metadata; it is stored only in the narrow identity index.
    assert.equal(store.db.prepare('SELECT 1 FROM transactions WHERE txid = ?').get(Buffer.from(id(302), 'hex')), undefined);
    store.rollbackTip();
    assert.equal(store.category(id(100))?.fungible_supply, '100');
  } finally { store.close(); }
});

test('missing genesis and nonzero scan boundaries return explicit incomplete coverage', async t => {
  const store = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 1 });
  store.setAnchor(0, id(1000));
  store.applyBlock(block(1, [tx(101, [output(id(100), '100')], [{ txid: id(100), vout: 0 }])]));
  const api = await createApi({ store, corsOrigins: [] });
  t.after(async () => { await api.close(); store.close(); });
  const observed = store.authchain(id(100));
  assert.equal(observed.status, 'incomplete');
  assert.equal(observed.coverage.status, 'incomplete');
  assert.ok(observed.authhead);
  assert.equal(observed.authhead.txid, id(101));
  const missing = store.authchain(id(999));
  assert.equal(missing.status, 'incomplete');
  assert.equal('authhead' in missing, false);
  assert.equal((await api.inject(`/v1/tokens/${id(100)}/authchain?limit=501`)).statusCode, 400);
  assert.equal((await api.inject('/v1/tokens/nope/authchain')).statusCode, 400);
});

test('publication parsing preserves digest byte order, IPFS/raw URIs and rejects malformed pushes/UTF8', () => {
  const parsed = parsePublication(publication);
  assert.equal(parsed.status, 'published');
  assert.ok('content_hash' in parsed);
  assert.equal(parsed.content_hash, digest);
  assert.deepEqual(parsed.uris, ['example.org']);
  assert.equal(parsePublication(null).status, 'none');
  for (const script of ['6a0442434d52', '6a0442434d5220aa', `6a0442434d5220${digest}01ff`, `6a0442434d5220${digest}76`]) {
    assert.equal(parsePublication(script).status, 'invalid');
  }
  const nonMinimal = parsePublication(`6a4c0442434d524c20${digest}4d0700${Buffer.from('ipfs://').toString('hex')}`);
  assert.equal(nonMinimal.status, 'published');
});

test('published authchain JSON schema matches the server integration boundary', () => {
  const published = JSON.parse(readFileSync(new URL('../docs/authchain-api-v1.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(published, z.toJSONSchema(authchainEnvelope, { io: 'input' }));
});
