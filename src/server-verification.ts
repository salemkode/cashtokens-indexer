import assert from 'node:assert/strict';
import { z } from 'zod';
import { hash, hex, amount } from './model.js';
import { chipnetCheckpoint, chipnetGenesis } from './network.js';
import { verifyArchiveReadiness } from './archive-readiness.js';
import type { BitcoinRpc } from './rpc.js';
import { activityEnvelope } from './activity-contract.js';

export const serverPins = {
  mainnet: { chain: 'main', genesis: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
    checkpoint: { height: 792773, hash: '000000000000000002fc0cdadaef1857bbd2936d37ea94f80ba3db4a5e8353e8' } },
  chipnet: { chain: 'chip', genesis: chipnetGenesis, checkpoint: chipnetCheckpoint },
};
export const serverCheckOptions = z.object({
  network: z.enum(['mainnet', 'chipnet']), category: hash,
  maxOutputs: z.number().int().min(1).max(100).default(50),
  maxTipAgeSeconds: z.number().int().min(60).max(86400).default(7200),
});
const nativeChain = z.object({ chain: z.string(), blocks: z.number().int().nonnegative(), bestblockhash: hash,
  initialblockdownload: z.literal(false) });

/** Bounded read-only sample. Does not certify all categories, throughput or UI journeys. */
export async function verifyServer(input: z.input<typeof serverCheckOptions>, rpc: Pick<BitcoinRpc, 'call'>,
  historyRpc: Pick<BitcoinRpc, 'call'>, get: (path: string) => Promise<unknown>) {
  const options = serverCheckOptions.parse(input);
  const pins = serverPins[options.network];
  const before = nativeChain.parse(await rpc.call('getblockchaininfo'));
  assert.equal(before.chain, pins.chain, 'Wrong native network');
  assert.ok(before.blocks >= pins.checkpoint.height, 'Source has not reached network checkpoint');
  for (const source of [rpc, historyRpc]) {
    assert.equal(await source.call('getblockhash', [0]), pins.genesis, 'Wrong native genesis');
    assert.equal(await source.call('getblockhash', [pins.checkpoint.height]), pins.checkpoint.hash, 'Wrong native checkpoint');
  }
  const archive = await verifyArchiveReadiness(historyRpc, { height: before.blocks, hash: before.bestblockhash });
  const ready = z.object({ network: z.enum(['mainnet', 'chipnet']), state: z.literal('synced'), node_ready: z.literal(true),
    source_height: z.number().int(), last_success_at: z.iso.datetime(), tip: z.object({ height: z.number().int(), hash }),
    genesis_hash: hash, start_height: z.literal(0), schema_version: z.literal(4),
    authchain_scan_start: z.literal(0), identity_scan_start: z.literal(0) }).parse(await get('/readyz'));
  assert.equal(ready.network, options.network, 'Wrong API network');
  assert.equal(ready.genesis_hash, pins.genesis);
  assert.equal(ready.tip.height, before.blocks);
  assert.equal(ready.source_height, before.blocks);
  assert.equal(ready.tip.hash, before.bestblockhash);
  const freshness = Date.now() - Date.parse(ready.last_success_at);
  assert.ok(freshness >= -5000 && freshness <= 30000, 'Stale or future-dated API synchronization');
  const envelope = z.object({ network: z.enum(['mainnet', 'chipnet']), confirmed_only: z.literal(true),
    indexed_height: z.number().int(), data: z.unknown() });
  async function tokenData(path: string) {
    const response = envelope.parse(await get(path));
    assert.equal(response.network, options.network);
    assert.equal(response.indexed_height, ready.tip.height, 'API tip changed during sample');
    return response.data;
  }
  const category = z.object({ category: hash, genesis_verified: z.literal(true), genesis_txid: hash,
    fungible_supply: z.string().regex(/^\d+$/), nft_count: z.number().int().nonnegative(),
    minting_count: z.number().int().nonnegative(), utxo_count: z.number().int().min(1).max(options.maxOutputs) })
    .parse(await tokenData(`/v1/tokens/${options.category}`));
  assert.equal(category.category, options.category);
  const prefixedHex = z.string().startsWith('\\x').transform(value => hex.parse(value.slice(2)));
  const outputs = z.array(z.object({ transaction_hash: prefixedHex.pipe(hash), output_index: z.number().int().nonnegative(),
    fungible_token_amount: amount, locking_bytecode: prefixedHex,
    nonfungible_token_capability: z.enum(['none', 'mutable', 'minting']).nullable(),
    nonfungible_token_commitment: prefixedHex.nullable() })).max(options.maxOutputs)
    .parse(await tokenData(`/v1/tokens/${options.category}/utxos?limit=${options.maxOutputs}`));
  assert.equal(outputs.length, category.utxo_count, 'Incomplete UTXO sample');
  assert.equal(new Set(outputs.map(output => `${output.transaction_hash}:${output.output_index}`)).size, outputs.length, 'Duplicate UTXOs');
  assert.equal(outputs.reduce((sum, output) => sum + BigInt(output.fungible_token_amount), 0n).toString(), category.fungible_supply);
  assert.equal(outputs.filter(output => output.nonfungible_token_capability !== null).length, category.nft_count);
  assert.equal(outputs.filter(output => output.nonfungible_token_capability === 'minting').length, category.minting_count);
  for (const output of outputs) {
    const actual = z.object({ bestblock: hash, scriptPubKey: z.object({ hex }), tokenData: z.object({ category: hash, amount,
      nft: z.object({ capability: z.enum(['none', 'mutable', 'minting']), commitment: hex }).optional() }) })
      .parse(await rpc.call('gettxout', [output.transaction_hash, output.output_index, false]));
    assert.equal(actual.bestblock, ready.tip.hash);
    assert.equal(actual.tokenData.category, options.category);
    assert.equal(actual.tokenData.amount, output.fungible_token_amount);
    assert.equal(actual.scriptPubKey.hex, output.locking_bytecode);
    assert.equal(actual.tokenData.nft?.capability ?? null, output.nonfungible_token_capability);
    assert.equal(actual.tokenData.nft?.commitment ?? null, output.nonfungible_token_commitment);
  }
  const txid = category.genesis_txid;
  const transaction = z.object({ network: z.enum(['mainnet', 'chipnet']), confirmed_only: z.literal(true), data: z.object({ hash: prefixedHex.pipe(hash),
    inputs: z.array(z.object({ outpoint: z.object({ value_satoshis: z.string().regex(/^\d+$/) }).nullable() })) }) })
    .parse(await get(`/v1/bch/transactions/${txid}`));
  assert.equal(transaction.data.hash, txid);
  assert.equal(transaction.network, options.network);
  assert.ok(transaction.data.inputs.some(value => value.outpoint !== null), 'No native prevout sample');
  const header = z.object({ hash, height: z.number().int(), time: z.number().int() })
    .parse(await rpc.call('getblockheader', [ready.tip.hash, true]));
  assert.equal(header.hash, ready.tip.hash);
  assert.equal(header.height, ready.tip.height);
  const age = Math.floor(Date.now() / 1000) - header.time;
  assert.ok(age >= -120 && age <= options.maxTipAgeSeconds, 'Stale or future-dated native tip');
  const peers = z.object({ connections: z.number().int().positive() }).parse(await rpc.call('getnetworkinfo'));
  const status = z.object({ network: z.enum(['mainnet', 'chipnet']), start_height: z.literal(0), schema_version: z.literal(4),
    tip: z.object({ height: z.number().int(), hash }) }).parse(await get('/v1/status'));
  assert.equal(status.network, options.network);
  assert.deepEqual(status.tip, ready.tip);
  const activity = activityEnvelope.parse(await get('/v1/activity?limit=9'));
  assert.equal(activity.network, options.network);
  assert.equal(activity.indexed_height, ready.tip.height);
  assert.equal(activity.snapshot?.hash, ready.tip.hash);
  assert.equal(activity.coverage.token_state.status, 'complete_at_indexed_tip');
  const blocks = z.object({ network: z.enum(['mainnet', 'chipnet']), confirmed_only: z.literal(true), data: z.array(z.unknown()).min(1) })
    .parse(await get('/v1/bch/blocks?limit=1'));
  assert.equal(blocks.network, options.network);
  const latest = z.object({ hash: prefixedHex.pipe(hash), height: z.number().int() }).parse(blocks.data[0]);
  assert.equal(latest.hash, ready.tip.hash);
  assert.equal(latest.height, ready.tip.height);
  const pool = z.object({ network: z.enum(['mainnet', 'chipnet']), confirmed_only: z.literal(false),
    data: z.object({ name: z.enum(['mainnet', 'chipnet']), unconfirmed_transactions: z.array(z.unknown()),
      snapshot_consistency: z.literal('best_effort') }) }).parse(await get('/v1/bch/mempool?limit=9'));
  assert.equal(pool.network, options.network);
  assert.equal(pool.data.name, options.network);
  const after = nativeChain.parse(await rpc.call('getblockchaininfo'));
  assert.equal(after.chain, before.chain);
  assert.equal(after.bestblockhash, before.bestblockhash, 'Native tip changed; repeat read-only acceptance after catch-up');
  assert.equal(after.blocks, before.blocks);
  await verifyArchiveReadiness(historyRpc, { height: before.blocks, hash: before.bestblockhash });
  return { status: 'verified_sample' as const, network: options.network, measured_at: new Date().toISOString(),
    tip: ready.tip, start_height: ready.start_height, schema_version: ready.schema_version, archive,
    connections: peers.connections, tip_age_seconds: age, category: options.category, txid,
    checked_utxos: outputs.length, testnetFunctionalReady: false, publicReleaseReady: false };
}
