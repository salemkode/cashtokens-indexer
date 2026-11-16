import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenStore } from '../src/store.js';
import { createApi } from '../src/api.js';
import { block, tx, id, alice, bob } from './fixtures.js';
import { IndexerError } from '../src/model.js';

function plain(script = alice) { return { n: 0, value: 0.00001, scriptPubKey: { hex: script } }; }
function scenario() {
  const store = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 0 });
  const chain = [block(0, [tx(1, [plain()])]), block(1, [tx(2, [plain(), plain(`6a0442434d5220${'aa'.repeat(32)}`)], [{ txid: id(1), vout: 0 }])]),
    block(2, [tx(3, [plain()], [{ txid: id(2), vout: 0 }])])];
  for (const value of chain) store.applyBlock(value);
  store.setMeta('genesis_hash', id(1000));
  const state = { tipReads: 0, race: false };
  const rpc = { async call(method: string, params: unknown[] = []) {
    if (method === 'getblockchaininfo') return { chain: 'regtest', initialblockdownload: false };
    if (method === 'getblockhash') {
      if (params[0] === 2) {
        state.tipReads += 1;
        if (state.race && state.tipReads === 2) store.applyBlock(block(3, []));
      }
      return id(1000 + Number(params[0]));
    }
    if (method === 'getrawtransaction') return { ...chain[0]?.tx[0], blockhash: id(1000), confirmations: 3 };
    if (method === 'getblockheader') return { hash: id(1000), height: 0, time: 1700000000 };
    if (method === 'getblock') return chain.find(value => value.hash === params[0]);
    if (method === 'gettxout') return params[0] === id(3) ? { bestblock: id(1002), value: 0.00001, scriptPubKey: { hex: alice } } : null;
    throw new IndexerError({ message: 'Unexpected resolution RPC' });
  } };
  return { store, rpc, state };
}

test('arbitrary unpublished authbase resolves in bounded resumable scans, is watched afterward and invalidated on reorg', async t => {
  const { store, rpc } = scenario();
  const api = await createApi({ store, corsOrigins: [], rpc });
  t.after(async () => { await api.close(); store.close(); });
  assert.equal((await api.inject(`/v1/authchains/${id(1)}`)).json().data.status, 'incomplete');
  for (const expected of [202, 202, 200]) {
    const response = await api.inject({ method: 'POST', url: `/v1/authchains/${id(1)}/resolve`, payload: { max_blocks: 1 } });
    assert.equal(response.statusCode, expected, response.body);
    assert.equal(response.json().data.scanned_blocks, 1);
  }
  const resolved = (await api.inject(`/v1/authchains/${id(1)}`)).json().data;
  assert.equal(resolved.authhead.txid, id(3));
  assert.equal(resolved.coverage.method, 'targeted_native_scan');
  assert.equal(resolved.coverage.status, 'complete');
  assert.equal(resolved.latest_publication.txid, id(2));
  store.applyBlock(block(3, [tx(4, [plain(bob)], [{ txid: id(3), vout: 0 }])]));
  const watched = (await api.inject(`/v1/authchains/${id(1)}`)).json().data;
  assert.equal(watched.authhead.txid, id(4));
  assert.equal(watched.coverage.indexed_height, 3);
  store.rollbackTip();
  assert.equal(store.resolved(id(1)), null);
});

test('index advancing during the final native validation cannot publish a stale complete resolution', async t => {
  const { store, rpc, state } = scenario();
  state.race = true;
  const api = await createApi({ store, corsOrigins: [], rpc });
  t.after(async () => { await api.close(); store.close(); });
  const response = await api.inject({ method: 'POST', url: `/v1/authchains/${id(1)}/resolve`, payload: { max_blocks: 10 } });
  assert.equal(response.statusCode, 502);
  assert.equal(store.tip()?.height, 3);
  assert.equal(store.resolved(id(1)), null);
});
