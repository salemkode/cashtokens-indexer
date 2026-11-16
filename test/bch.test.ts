import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerBchRoutes } from '../src/bch.js';
import { IndexerError } from '../src/model.js';
import { RpcResponseError } from '../src/rpc.js';

function id(value: number) { return value.toString(16).padStart(64, '0'); }
const script = `76a914${'11'.repeat(20)}88ac`;
const category = id(100);
const coinbase = { txid: id(1), vin: [{ coinbase: '00' }],
  vout: [{ n: 0, value: 50.00001, scriptPubKey: { hex: script } }], size: 100 };
const previous = { txid: id(2), vin: [{ coinbase: '00' }],
  vout: [{ n: 0, value: 8.00001, scriptPubKey: { hex: script },
    tokenData: { category, amount: '9007199254740993', nft: { capability: 'mutable', commitment: '' } } }], size: 120 };
const regular = { txid: id(3), vin: [{ txid: id(2), vout: 0, scriptSig: { hex: '01' } }],
  vout: [{ n: 0, value: 8, scriptPubKey: { hex: script },
    tokenData: { category, amount: '9007199254740993', nft: { capability: 'none', commitment: 'abcd' } } }],
  size: 200, blockhash: id(1000), confirmations: 1 };

function node() {
  const state = { chain: 'regtest', height: 0, missing: false, statsFail: false, underclaim: false,
    mempool: false, calls: new Array<{ method: string; params: unknown[] }>() };
  const rpc = { async call(method: string, params: unknown[] = []) {
    state.calls.push({ method, params });
    if (method === 'getblockchaininfo') return { chain: state.chain, blocks: state.height };
    if (method === 'getblockhash') return id(1000);
    if (method === 'getblockheader') return { height: 0, hash: id(1000), time: 1700000000, nTx: 2, confirmations: 1 };
    if (method === 'getblockstats') {
      if (state.statsFail) throw new IndexerError({ message: 'private-secret-stats-failure' });
      return { total_out: 8, totalfee: 0.00001, subsidy: 50, ins: 1, outs: 2, txs: 2, total_size: 200 };
    }
    if (method === 'getblock' && params[1] === 1) return { height: 0, hash: id(1000), time: 1700000000, size: 381, tx: [id(1), id(3)] };
    if (method === 'getblock') return { height: 0, hash: id(1000), time: 1700000000, size: 381,
      confirmations: 1, tx: [{ ...coinbase, vout: [{ n: 0, value: state.underclaim ? 49 : 50.00001, scriptPubKey: { hex: script } }] }, regular] };
    if (method === 'getrawtransaction') {
      if (state.missing) throw new RpcResponseError(method, -5);
      if (params[0] === id(2)) return previous;
      if (params[0] === id(3)) return state.mempool ? { ...regular, blockhash: undefined, confirmations: 0 } : regular;
      throw new RpcResponseError(method, -5);
    }
    if (method === 'getrawmempool') return { [id(3)]: { time: 1700000001 } };
    if (method === 'getnetworkinfo') return { subversion: '/Bitcoin Cash Node:test/' };
    throw new IndexerError({ message: 'Unexpected RPC method' });
  } };
  const app = Fastify();
  registerBchRoutes(app, { rpc, network: 'regtest' });
  return { app, state, rpc };
}

test('BCH transaction reads resolve token prevouts, preserve integer precision and inclusions', async t => {
  const { app, state } = node();
  t.after(() => app.close());
  const response = await app.inject(`/v1/bch/transactions/${id(3)}`);
  assert.equal(response.statusCode, 200);
  const { data, network, confirmed_only } = response.json();
  assert.equal(network, 'regtest');
  assert.equal(confirmed_only, true);
  assert.equal(data.input_value_satoshis, '800001000');
  assert.equal(data.output_value_satoshis, '800000000');
  assert.equal(data.inputs[0].outpoint.fungible_token_amount, '9007199254740993');
  assert.equal(data.inputs[0].outpoint.nonfungible_token_commitment, '\\x');
  assert.equal(data.outputs[0].token_category, `\\x${category}`);
  assert.equal(data.outputs[0].nonfungible_token_commitment, '\\xabcd');
  assert.equal(data.block_inclusions[0].block.hash, `\\x${id(1000)}`);
  await app.inject(`/v1/bch/transactions/${id(3)}`);
  assert.equal(state.calls.filter(call => call.method === 'getrawtransaction' && call.params[0] === id(2)).length, 1);
  assert.equal(state.calls.filter(call => call.method === 'getrawtransaction' && call.params[0] === id(3)).length, 2);
  const batch = await app.inject(`/v1/bch/transactions?ids=${id(3)},${id(3)}`);
  assert.equal(batch.json().data.length, 2);
  assert.deepEqual((await app.inject('/v1/bch/transactions?ids=')).json().data, []);
});

test('BCH block detail aggregates exact values including actual underclaimed coinbase', async t => {
  const { app, state } = node();
  state.underclaim = true;
  t.after(() => app.close());
  const response = await app.inject('/v1/bch/blocks/0?limit=1&offset=1');
  assert.equal(response.statusCode, 200);
  const { data } = response.json();
  assert.equal(data.size_bytes, 381);
  assert.equal(data.transaction_count, 2);
  assert.equal(data.input_count, 2);
  assert.equal(data.output_count, 2);
  assert.equal(data.output_value_satoshis, '5700000000');
  assert.equal(data.fee_satoshis, '1000');
  assert.equal(data.generated_value_satoshis, '4899999000');
  assert.equal(data.input_value_satoshis, '800001000');
  assert.equal(data.transactions.length, 1);
  assert.equal(data.transactions[0].transaction.hash, `\\x${id(3)}`);
  assert.equal(data.transactions[0].transaction.block_inclusions[0].block.height, 0);
  const list = (await app.inject('/v1/bch/blocks?limit=1')).json().data;
  assert.equal(list[0].fee_satoshis, null);
  assert.equal(list[0].input_value_satoshis, null);
  assert.equal(list[0].output_value_satoshis, null);
  assert.equal(list[0].generated_value_satoshis, null);
  assert.equal(list[0].size_bytes, 381);
});

test('missing undo statistics keep block detail usable with explicit unknown aggregates', async t => {
  const { app, state } = node();
  state.statsFail = true;
  t.after(() => app.close());
  const response = await app.inject('/v1/bch/blocks/0');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.fee_satoshis, null);
  assert.equal(response.json().data.generated_value_satoshis, null);
  assert.equal(response.json().data.output_value_satoshis, '5800001000');
  assert.equal(response.body.includes('private-secret'), false);
});

test('tip reads coalesce cached requests and block pagination is bounded', async t => {
  const { app, state } = node();
  t.after(() => app.close());
  const responses = await Promise.all([app.inject('/v1/bch/tip'), app.inject('/v1/bch/tip')]);
  for (const response of responses) {
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.hash, `\\x${id(1000)}`);
    assert.equal(response.json().data.timestamp, 1700000000);
  }
  assert.equal(state.calls.filter(call => call.method === 'getblockchaininfo').length, 1);
  assert.equal(state.calls.filter(call => call.method === 'getblockheader').length, 1);
  assert.deepEqual((await app.inject('/v1/bch/blocks?offset=1')).json().data, []);
  assert.equal((await app.inject('/v1/bch/blocks?limit=101')).statusCode, 400);
  assert.equal((await app.inject('/v1/bch/blocks?offset=-1')).statusCode, 400);
  assert.equal((await app.inject('/v1/bch/blocks/1')).statusCode, 404);
  assert.equal((await app.inject('/v1/bch/transactions/not-a-hash')).statusCode, 400);
  assert.equal((await app.inject(`/v1/bch/transactions?ids=${Array.from({ length: 51 }, () => id(3)).join(',')}`)).statusCode, 400);
});

test('mempool is explicitly unconfirmed and uses node acceptance time', async t => {
  const { app, state } = node();
  state.mempool = true;
  t.after(() => app.close());
  const response = await app.inject('/v1/bch/mempool?limit=1');
  assert.equal(response.statusCode, 200);
  const { data } = response.json();
  assert.equal(response.json().confirmed_only, false);
  assert.equal(data.name, 'regtest');
  assert.equal(data.unconfirmed_transaction_count, 1);
  assert.equal(data.unconfirmed_transactions[0].validated_at, '2023-11-14T22:13:21.000Z');
  assert.deepEqual(data.unconfirmed_transactions[0].transaction.block_inclusions, []);
  assert.equal((await app.inject(`/v1/bch/transactions/${id(3)}`)).json().confirmed_only, false);
});

test('network mismatch, foreign mainnet fork, and RPC failure never expose node details', async t => {
  const wrong = node();
  wrong.state.chain = 'chip';
  t.after(() => wrong.app.close());
  const mismatch = await wrong.app.inject('/v1/bch/tip');
  assert.equal(mismatch.statusCode, 502);
  assert.equal(wrong.state.calls.some(call => call.method === 'getblockheader'), false);
  const main = Fastify();
  const other = node();
  other.state.chain = 'main';
  other.state.height = 900000;
  registerBchRoutes(main, { rpc: other.rpc, network: 'mainnet' });
  t.after(async () => { await main.close(); await other.app.close(); });
  assert.equal((await main.inject('/v1/bch/tip')).statusCode, 502);
  const missing = node();
  missing.state.missing = true;
  t.after(() => missing.app.close());
  const notFound = await missing.app.inject(`/v1/bch/transactions/${id(3)}`);
  assert.equal(notFound.statusCode, 404);
  assert.equal(notFound.body.includes('RPC'), false);
});

test('same-block CTOR prevouts resolve from the local block map without txindex lookups', async t => {
  const base = node();
  const app = Fastify();
  const creator = { ...regular, txid: id(5), blockhash: undefined, confirmations: undefined };
  const spender = { ...regular, txid: id(4), vin: [{ txid: id(5), vout: 0, scriptSig: { hex: '' } }] };
  const rpc = { async call(method: string, params: unknown[] = []) {
    if (method === 'getblock') return { height: 0, hash: id(1000), time: 1700000000, size: 500,
      confirmations: 1, tx: [coinbase, spender, creator] };
    return base.rpc.call(method, params);
  } };
  registerBchRoutes(app, { rpc, network: 'regtest' });
  t.after(async () => { await app.close(); await base.app.close(); });
  const response = await app.inject('/v1/bch/blocks/0');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.transactions[1].transaction.inputs[0].outpoint.value_satoshis, '800000000');
  assert.equal(base.state.calls.some(call => call.method === 'getrawtransaction' && call.params[0] === id(5)), false);
  await app.inject('/v1/bch/blocks/0');
  assert.equal(base.state.calls.filter(call => call.method === 'getblockstats').length, 1);
});

test('RPC concurrency is capped globally and bounded decoded block projections are reused', async t => {
  const base = node();
  const app = Fastify();
  const activity = { active: 0, maximum: 0, bodies: 0 };
  const rpc = { async call(method: string, params: unknown[] = []) {
    activity.active += 1;
    activity.maximum = Math.max(activity.maximum, activity.active);
    if (method === 'getblock') activity.bodies += 1;
    try {
      await new Promise(resolve => setTimeout(resolve, 2));
      if (method === 'getrawtransaction' && params[0] !== id(2)) return { ...regular, txid: String(params[0]) };
      return await base.rpc.call(method, params);
    } finally { activity.active -= 1; }
  } };
  registerBchRoutes(app, { rpc, network: 'regtest' });
  t.after(async () => { await app.close(); await base.app.close(); });
  const ids = Array.from({ length: 30 }, (_, index) => id(3 + index)).join(',');
  const response = await app.inject(`/v1/bch/transactions?ids=${ids}`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.length, 30);
  assert.equal(activity.maximum, 8);
  await app.inject('/v1/bch/blocks/0');
  await app.inject('/v1/bch/blocks/0');
  assert.equal(activity.bodies, 1);
});

test('native verbosity 2 inputs and verbosity 3 nested prevouts avoid parent RPC fanout', async t => {
  const base = node();
  const app = Fastify();
  const calls = new Array<{ method: string; params: unknown[] }>();
  const enriched = { ...regular, vin: [{ ...regular.vin[0], ...previous.vout[0] }] };
  const rpc = { async call(method: string, params: unknown[] = []) {
    calls.push({ method, params });
    if (method === 'getrawtransaction') {
      assert.equal(params[1], 2);
      return enriched;
    }
    if (method === 'getblock') return { height: 0, hash: id(1000), time: 1700000000, size: 381, confirmations: 1,
      tx: [coinbase, { ...regular, vin: [{ ...regular.vin[0], prevout: previous.vout[0] }] }] };
    return base.rpc.call(method, params);
  } };
  registerBchRoutes(app, { rpc, network: 'regtest' });
  t.after(async () => { await app.close(); await base.app.close(); });
  const direct = await app.inject(`/v1/bch/transactions/${id(3)}`);
  assert.equal(direct.statusCode, 200);
  assert.equal(direct.json().data.input_value_satoshis, '800001000');
  const detail = await app.inject('/v1/bch/blocks/0');
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().data.transactions[1].transaction.inputs[0].outpoint.fungible_token_amount, '9007199254740993');
  assert.deepEqual(calls.filter(call => call.method === 'getrawtransaction').map(call => call.params), [[id(3), 2]]);
  assert.equal(calls.find(call => call.method === 'getblock')?.params[1], 3);
  assert.deepEqual(calls.find(call => call.method === 'getblockstats')?.params[1], ['totalfee']);
});

test('height/homepage requests avoid statistics and legacy enriched-verbosity fallback remains explicit', async t => {
  const base = node();
  const app = Fastify();
  const calls = new Array<{ method: string; params: unknown[] }>();
  const rpc = { async call(method: string, params: unknown[] = []) {
    calls.push({ method, params });
    if ((method === 'getrawtransaction' && params[1] === 2) || (method === 'getblock' && params[1] === 3)) {
      throw new RpcResponseError(method, -8);
    }
    return base.rpc.call(method, params);
  } };
  registerBchRoutes(app, { rpc, network: 'regtest' });
  t.after(async () => { await app.close(); await base.app.close(); });
  const height = await app.inject('/v1/bch/height');
  assert.equal(height.json().data.height, 0);
  assert.deepEqual(calls.map(call => call.method), ['getblockchaininfo']);
  const list = await app.inject('/v1/bch/blocks?limit=1');
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().data[0].size_bytes, 381);
  assert.equal(calls.some(call => call.method === 'getblockstats' || call.method === 'getblockheader'), false);
  assert.equal((await app.inject(`/v1/bch/transactions/${id(3)}`)).statusCode, 200);
  assert.ok(calls.some(call => call.method === 'getrawtransaction' && call.params[1] === true));
  assert.equal((await app.inject('/v1/bch/blocks/0')).statusCode, 200);
  assert.ok(calls.some(call => call.method === 'getblock' && call.params[1] === 2));
});

test('cached block projection cannot make an orphan appear canonical on a later page', async t => {
  const base = node();
  const app = Fastify();
  const state = { orphan: false, reads: 0 };
  const rpc = { async call(method: string, params: unknown[] = []) {
    if (method === 'getblock') state.reads += 1;
    if (method === 'getblockheader') return { height: 0, hash: id(1000), time: 1700000000,
      confirmations: state.orphan ? -1 : 1 };
    return base.rpc.call(method, params);
  } };
  registerBchRoutes(app, { rpc, network: 'regtest' });
  t.after(async () => { await app.close(); await base.app.close(); });
  assert.equal((await app.inject('/v1/bch/blocks/0?limit=1')).statusCode, 200);
  state.orphan = true;
  assert.equal((await app.inject('/v1/bch/blocks/0?limit=1&offset=1')).statusCode, 404);
  assert.equal(state.reads, 1);
});

test('malformed native data and unavailable parent inputs are upstream failures, not invalid user requests', async t => {
  const base = node();
  const malformed = Fastify();
  const incomplete = Fastify();
  registerBchRoutes(malformed, { network: 'regtest', rpc: { async call(method, params) {
    if (method === 'getrawtransaction') return { txid: 'broken' };
    return base.rpc.call(method, params);
  } } });
  registerBchRoutes(incomplete, { network: 'regtest', rpc: { async call(method, params = []) {
    if (method === 'getrawtransaction' && params[0] === id(2)) throw new RpcResponseError(method, -5);
    return base.rpc.call(method, params);
  } } });
  t.after(async () => { await malformed.close(); await incomplete.close(); await base.app.close(); });
  assert.equal((await malformed.inject(`/v1/bch/transactions/${id(3)}`)).statusCode, 502);
  assert.equal((await incomplete.inject(`/v1/bch/transactions/${id(3)}`)).statusCode, 502);
  assert.equal((await malformed.inject('/v1/bch/transactions/not-a-hash')).statusCode, 400);
});

test('mempool snapshot coalesces readers and reports eviction/mining races without fabricated pending records', async t => {
  const base = node();
  const app = Fastify();
  const state = { evicted: true, poolReads: 0 };
  registerBchRoutes(app, { network: 'regtest', rpc: { async call(method, params = []) {
    if (method === 'getrawmempool') state.poolReads += 1;
    if (method === 'getrawtransaction' && state.evicted) throw new RpcResponseError(method, -5);
    return base.rpc.call(method, params);
  } } });
  t.after(async () => { await app.close(); await base.app.close(); });
  const responses = await Promise.all([app.inject('/v1/bch/mempool'), app.inject('/v1/bch/mempool')]);
  assert.equal(state.poolReads, 1);
  assert.equal(responses[0]?.statusCode, 200);
  assert.deepEqual(responses[0]?.json().data.changed_txids, [id(3)]);
  assert.deepEqual(responses[0]?.json().data.unconfirmed_transactions, []);
  state.evicted = false;
  // The node now reports this formerly pending transaction as confirmed: it is omitted explicitly.
  const mined = await app.inject('/v1/bch/mempool');
  assert.deepEqual(mined.json().data.changed_txids, [id(3)]);
  assert.equal(mined.json().confirmed_only, false);
});
