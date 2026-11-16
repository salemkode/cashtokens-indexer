import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyServer, serverPins } from '../src/server-verification.js';
import { IndexerError } from '../src/model.js';

function scenario(network: keyof typeof serverPins) {
  const pins = serverPins[network];
  const tip = { height: pins.checkpoint.height + 100, hash: 'a'.repeat(64) };
  const category = 'b'.repeat(64);
  const txid = 'c'.repeat(64);
  const output = { transaction_hash: `\\x${txid}`, output_index: 0, fungible_token_amount: '9007199254740993',
    locking_bytecode: '\\x51', nonfungible_token_capability: 'minting', nonfungible_token_commitment: '\\x' };
  const state = { chain: pins.chain, apiNetwork: network.toString(), genesis: pins.genesis, checkpoint: pins.checkpoint.hash,
    pruned: false, indexed: true, start: 0, metadataStart: 0, age: 0, staleApi: false, advance: false, tip: tip.hash, nativeAmount: output.fungible_token_amount,
    supply: output.fungible_token_amount, utxoCount: 1, badBlocks: false, outputs: [output], methods: new Array<string>() };
  const rpc = { async call(method: string, params: unknown[] = []) {
    state.methods.push(method);
    if (method === 'getblockchaininfo') return { chain: state.chain, blocks: tip.height, bestblockhash: state.tip,
      pruned: state.pruned, initialblockdownload: false };
    if (method === 'getblockhash') return params[0] === 0 ? state.genesis : state.checkpoint;
    if (method === 'getindexinfo') return { txindex: { synced: state.indexed, best_block_height: tip.height } };
    if (method === 'gettxout') {
      assert.deepEqual(params, [txid, 0, false]);
      return { bestblock: tip.hash, scriptPubKey: { hex: '51' }, tokenData: { category, amount: state.nativeAmount,
        nft: { capability: 'minting', commitment: '' } } };
    }
    if (method === 'getblockheader') return { ...tip, time: Math.floor(Date.now() / 1000) - state.age };
    if (method === 'getnetworkinfo') { if (state.advance) state.tip = 'd'.repeat(64); return { connections: 3 }; }
    throw new IndexerError({ message: 'Unexpected RPC method' });
  } };
  async function get(path: string) {
    if (path === '/readyz') return { network: state.apiNetwork, state: 'synced', node_ready: true,
      source_height: tip.height, last_success_at: new Date(Date.now() - (state.staleApi ? 60000 : 0)).toISOString(),
      tip, genesis_hash: pins.genesis, start_height: state.start, schema_version: 4,
      authchain_scan_start: state.metadataStart, identity_scan_start: state.metadataStart };
    if (path.startsWith('/v1/bch/transactions/')) return { network: state.apiNetwork, confirmed_only: true,
      data: { hash: `\\x${txid}`, inputs: [{ outpoint: { value_satoshis: '800' } }] } };
    const envelope = { network: state.apiNetwork, confirmed_only: true, indexed_height: tip.height };
    if (path === `/v1/tokens/${category}`) return { ...envelope, data: { category, genesis_verified: true, genesis_txid: txid,
      fungible_supply: state.supply, utxo_count: state.utxoCount, nft_count: 1, minting_count: 1 } };
    if (path.startsWith(`/v1/tokens/${category}/utxos`)) return { ...envelope, data: state.outputs };
    if (path === '/v1/status') return { network: state.apiNetwork, start_height: 0, schema_version: 4, tip };
    if (path === '/v1/activity?limit=9') return { ...envelope, snapshot: { ...tip, previousHash: '0'.repeat(64) },
      coverage: { start_height: 0, token_state: { status: 'complete_at_indexed_tip', reason: null }, gross_fungible_details_start: 0 },
      order: 'block_height_desc,transaction_position_desc,txid_asc', metadata_only_authchain_events: 'excluded', data: [] };
    if (path.includes('mempool')) return { network: state.apiNetwork, confirmed_only: false,
      data: { name: state.apiNetwork, unconfirmed_transactions: [], snapshot_consistency: 'best_effort' } };
    return { network: state.apiNetwork, confirmed_only: true,
      data: [{ height: tip.height, hash: `\\x${state.badBlocks ? '0'.repeat(64) : tip.hash}` }] };
  }
  return { state, output, check: () => verifyServer({ network, category }, rpc, rpc, get) };
}

for (const network of ['mainnet', 'chipnet'] as const) {
  test(`server acceptance verifies ${network}, exact amounts above 2^53 and blank NFT commitments with read-only calls`, async () => {
    const sample = scenario(network);
    const report = await sample.check();
    assert.equal(report.status, 'verified_sample');
    assert.equal(report.network, network);
    assert.equal(report.checked_utxos, 1);
    assert.equal(report.testnetFunctionalReady, false);
    assert.ok(sample.state.methods.every(method => ['getblockchaininfo', 'getblockhash', 'getindexinfo',
      'gettxout', 'getblockheader', 'getnetworkinfo'].includes(method)));
  });
}

test('server acceptance refuses wrong chains, checkpoints, pruning and absent txindex', async () => {
  const chain = scenario('mainnet'); chain.state.chain = 'test'; await assert.rejects(chain.check());
  const genesis = scenario('chipnet'); genesis.state.genesis = '0'.repeat(64); await assert.rejects(genesis.check());
  const checkpoint = scenario('mainnet'); checkpoint.state.checkpoint = '0'.repeat(64); await assert.rejects(checkpoint.check());
  const pruned = scenario('chipnet'); pruned.state.pruned = true; await assert.rejects(pruned.check());
  const indexed = scenario('mainnet'); indexed.state.indexed = false; await assert.rejects(indexed.check());
});

test('server acceptance refuses incomplete coverage, stale results and native tip movement', async () => {
  const partial = scenario('mainnet'); partial.state.start = 792773; await assert.rejects(partial.check());
  const migrated = scenario('mainnet'); migrated.state.metadataStart = 1; await assert.rejects(migrated.check());
  const stale = scenario('chipnet'); stale.state.staleApi = true; await assert.rejects(stale.check());
  const header = scenario('mainnet'); header.state.age = 10000; await assert.rejects(header.check());
  const moved = scenario('chipnet'); moved.state.advance = true; await assert.rejects(moved.check(), /tip changed/);
  const wrong = scenario('mainnet'); wrong.state.apiNetwork = 'chipnet'; await assert.rejects(wrong.check());
});

test('server acceptance refuses incorrect supply, mismatched native output, truncated and duplicate output samples', async () => {
  const supply = scenario('chipnet'); supply.state.supply = '9007199254740992'; await assert.rejects(supply.check());
  const native = scenario('mainnet'); native.state.nativeAmount = '1'; await assert.rejects(native.check());
  const truncated = scenario('mainnet'); truncated.state.utxoCount = 2; await assert.rejects(truncated.check(), /Incomplete/);
  const duplicate = scenario('chipnet'); duplicate.state.utxoCount = 2;
  duplicate.state.outputs.push({ ...duplicate.output });
  await assert.rejects(duplicate.check(), /Duplicate/);
  const large = scenario('mainnet'); large.state.utxoCount = 101; await assert.rejects(large.check());
  const blocks = scenario('mainnet'); blocks.state.badBlocks = true; await assert.rejects(blocks.check());
});
