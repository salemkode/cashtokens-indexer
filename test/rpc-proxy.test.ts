import test from 'node:test';
import assert from 'node:assert/strict';
import { IndexerError } from '../src/model.js';
import { createReadProxy } from '../src/rpc-proxy.js';
import { chipnetCheckpoint, chipnetGenesis } from '../src/network.js';

test('server-to-server proxy verifies Chipnet identity and never forwards wallet/write/browser requests', async t => {
  const calls = new Array<string>();
  const state = { wrong: false };
  const proxy = createReadProxy({ async call(method, params = []) {
    calls.push(method);
    if (method === 'getblockchaininfo') return { chain: 'chip', blocks: 332433 };
    if (method === 'getblockhash') return params[0] === 0 ? chipnetGenesis : state.wrong ? '0'.repeat(64) : chipnetCheckpoint.hash;
    if (method === 'gettxout') return { value: 0.01 };
    if (method === 'getindexinfo') return { txindex: { synced: true, best_block_height: 332433 } };
    throw new IndexerError({ message: 'Unexpected fixture read' });
  } }, 'chipnet');
  t.after(() => proxy.close());
  const good = await proxy.inject({ method: 'POST', url: '/', payload: { id: 'ok', method: 'gettxout', params: ['1'.repeat(64), 0] } });
  assert.equal(good.json().result.value, 0.01);
  assert.equal(good.json().error, null);
  const index = await proxy.inject({ method: 'POST', url: '/', payload: { id: 'index', method: 'getindexinfo', params: ['txindex'] } });
  assert.deepEqual(index.json().result, { txindex: { synced: true, best_block_height: 332433 } });
  for (const method of ['sendrawtransaction', 'testmempoolaccept', 'dumpprivkey', 'stop']) {
    assert.equal((await proxy.inject({ method: 'POST', url: '/', payload: { id: 1, method } })).json().error.code, -32601);
    assert.equal(calls.includes(method), false);
  }
  assert.equal((await proxy.inject({ method: 'POST', url: '/', headers: { origin: 'https://untrusted.invalid' },
    payload: { id: 2, method: 'gettxout' } })).statusCode, 403);
  state.wrong = true;
  const wrong = await proxy.inject({ method: 'POST', url: '/', payload: { id: 'bad', method: 'gettxout' } });
  assert.equal(wrong.json().result, null);
  assert.equal(wrong.json().error.code, -32000);
});
