import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { TokenStore } from '../src/store.js';
import { createApi } from '../src/api.js';
import { verifyRegistry } from '../src/metadata.js';
import { block, tx, id, alice, bob } from './fixtures.js';

function plain(script = alice) { return { n: 0, value: 0.00001, scriptPubKey: { hex: script } }; }
const registry = JSON.stringify({ version: { major: 0, minor: 1, patch: 0 },
  latestRevision: '2026-11-15T00:00:00.000Z', registryIdentity: { name: 'Example' } });
const digest = createHash('sha256').update(registry).digest('hex');
const publication = `6a0442434d5220${digest}`;

test('non-category publication roots and overlapping chains share one node/edge history, survive rollback', async t => {
  const store = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 0 });
  const api = await createApi({ store, corsOrigins: [] });
  t.after(async () => { await api.close(); store.close(); });
  store.applyBlock(block(0, [tx(1, [plain(), plain(publication)])]));
  assert.equal(store.identity(id(1)).authchain_length, 0);
  store.applyBlock(block(1, [tx(2, [plain(bob), plain(publication)], [{ txid: id(1), vout: 0 }])]));
  store.applyBlock(block(2, [tx(3, [plain()], [{ txid: id(2), vout: 0 }])]));
  for (const base of [id(1), id(2)]) {
    const response = await api.inject(`/v1/authchains/${base}`);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().data.authhead.txid, id(3));
    assert.equal(response.json().data.latest_publication.txid, id(2));
    assert.equal(response.json().data.discovery_only, true);
  }
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM identity_nodes').get()?.count, 3);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM identity_edges').get()?.count, 2);
  store.rollbackTip();
  assert.equal(store.identity(id(1)).authhead?.txid, id(2));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM transactions').get()?.count, 0);
});

test('registered publication-free authbase resolves CTOR and requires explicit scan configuration', () => {
  const store = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 0, authbases: [id(1)] });
  try {
    store.applyBlock(block(0, [tx(3, [plain()], [{ txid: id(2), vout: 0 }]),
      tx(2, [plain()], [{ txid: id(1), vout: 0 }]), tx(1, [plain()])]));
    assert.equal(store.identity(id(1)).authhead?.txid, id(3));
    assert.equal(store.identity(id(1)).authchain_length, 2);
    assert.equal(store.identity(id(999)).status, 'incomplete');
  } finally { store.close(); }
});

test('metadata verification binds exact bytes to indexed publication, validates schema and caches content without authority claims', async t => {
  const store = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 0 });
  const api = await createApi({ store, corsOrigins: [] });
  t.after(async () => { await api.close(); store.close(); });
  store.applyBlock(block(0, [tx(1, [plain(), plain(publication)])]));
  assert.equal((await api.inject(`/v1/authchains/${id(1)}/metadata`)).json().data.status, 'content_required');
  const mismatch = await api.inject({ method: 'POST', url: `/v1/authchains/${id(1)}/metadata/verify`,
    payload: { content_base64: Buffer.from('{}').toString('base64') } });
  assert.equal(mismatch.json().data.status, 'hash_mismatch');
  const verified = await api.inject({ method: 'POST', url: `/v1/authchains/${id(1)}/metadata/verify`,
    payload: { content_base64: Buffer.from(registry).toString('base64') } });
  assert.equal(verified.statusCode, 200, verified.body);
  assert.equal(verified.json().data.status, 'verified_content');
  assert.equal(verified.json().data.issuer_authority_verified, false);
  assert.equal((await api.inject(`/v1/authchains/${id(1)}/metadata`)).json().data.status, 'verified_content');
  const invalid = Buffer.from('{}');
  assert.equal(verifyRegistry(invalid, createHash('sha256').update(invalid).digest('hex')).status, 'invalid_schema');
  const notJson = Buffer.from('broken');
  assert.equal(verifyRegistry(notJson, createHash('sha256').update(notJson).digest('hex')).status, 'invalid_json');
  assert.equal((await api.inject({ method: 'POST', url: `/v1/authchains/${id(999)}/metadata/verify`,
    payload: { content_base64: '' } })).statusCode, 409);
});
