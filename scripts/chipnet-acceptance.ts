import { writeReport } from './reports.js';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { BitcoinRpc, readRpcMethods } from '../src/rpc.js';
import { verifyArchiveReadiness } from '../src/archive-readiness.js';
import { chipnetCheckpoint, chipnetGenesis } from '../src/network.js';
import { hash, hex, IndexerError } from '../src/model.js';

/** Read-only: never start a node, sign, fund, broadcast, download chainstate or guess a network. */
async function main() {
  const { values } = parseArgs({ options: { 'rest-url': { type: 'string' }, category: { type: 'string' },
    txid: { type: 'string' }, 'registry-file': { type: 'string' }, 'publish-connection': { type: 'boolean', default: false } } });
  const args = z.object({ 'rest-url': z.url(), category: hash, txid: hash.optional(),
    'registry-file': z.string().optional(), 'publish-connection': z.boolean() }).parse(values);
  const origin = new URL(args['rest-url']);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new IndexerError({ message: 'REST target must be a credential-free HTTP(S) origin' });
  }
  const config = z.object({ NETWORK: z.literal('chipnet'), BCH_RPC_URL: z.url(), BCH_RPC_USER: z.string().optional(),
    BCH_RPC_PASSWORD: z.string().optional(), BCH_RPC_COOKIE_FILE: z.string().optional(),
    BCH_HISTORY_RPC_URL: z.url().optional(), BCH_HISTORY_RPC_USER: z.string().optional(),
    BCH_HISTORY_RPC_PASSWORD: z.string().optional(), BCH_HISTORY_RPC_COOKIE_FILE: z.string().optional(),
    MAX_CHIPNET_TIP_AGE_SECONDS: z.coerce.number().int().min(60).max(86400).default(7200),
    RPC_PROXY_URL: z.url().optional() }).parse(process.env);
  if (config.RPC_PROXY_URL !== undefined) {
    const proxy = new URL(config.RPC_PROXY_URL);
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password || proxy.search || proxy.hash || proxy.pathname !== '/') {
      throw new IndexerError({ message: 'RPC proxy route must be a credential-free origin' });
    }
  }
  const rpc = new BitcoinRpc({ url: config.BCH_RPC_URL, username: config.BCH_RPC_USER, password: config.BCH_RPC_PASSWORD,
    cookieFile: config.BCH_RPC_COOKIE_FILE });
  const historyRpc = config.BCH_HISTORY_RPC_URL === undefined ? rpc : new BitcoinRpc({ url: config.BCH_HISTORY_RPC_URL,
    username: config.BCH_HISTORY_RPC_USER, password: config.BCH_HISTORY_RPC_PASSWORD, cookieFile: config.BCH_HISTORY_RPC_COOKIE_FILE });
  const before = z.object({ chain: z.literal('chip'), blocks: z.number().int(), bestblockhash: hash,
    initialblockdownload: z.literal(false) }).parse(await rpc.call('getblockchaininfo'));
  assert.equal(await rpc.call('getblockhash', [0]), chipnetGenesis);
  assert.equal(await rpc.call('getblockhash', [chipnetCheckpoint.height]), chipnetCheckpoint.hash);
  assert.equal(await historyRpc.call('getblockhash', [0]), chipnetGenesis);
  assert.equal(await historyRpc.call('getblockhash', [chipnetCheckpoint.height]), chipnetCheckpoint.hash);
  const archive = await verifyArchiveReadiness(historyRpc, { height: before.blocks, hash: before.bestblockhash });
  async function get(path: string) {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(30000), redirect: 'error' });
    assert.equal(response.status, 200, `REST ${path} unavailable`);
    return z.unknown().parse(await response.json());
  }
  const ready = z.object({ network: z.literal('chipnet'), state: z.literal('synced'), node_ready: z.literal(true),
    source_height: z.number(), last_success_at: z.iso.datetime(), tip: z.object({ height: z.number(), hash }),
    genesis_hash: z.literal(chipnetGenesis), start_height: z.number(), schema_version: z.literal(4),
    chain_checkpoint: z.object({ height: z.literal(chipnetCheckpoint.height), hash: z.literal(chipnetCheckpoint.hash) }),
  }).passthrough().parse(await get('/readyz'));
  assert.equal(ready.tip.height, before.blocks);
  assert.equal(ready.tip.hash, before.bestblockhash);
  assert.ok(Date.now() - Date.parse(ready.last_success_at) < 30000, 'Backend snapshot is stale');
  const envelope = z.object({ network: z.literal('chipnet'), confirmed_only: z.literal(true), indexed_height: z.number(), data: z.unknown() });
  const category = z.object({ category: hash, genesis_verified: z.literal(true), genesis_txid: hash,
    fungible_supply: z.string(), nft_count: z.number(), minting_count: z.number(), utxo_count: z.number().max(500) })
    .parse(envelope.parse(await get(`/v1/tokens/${args.category}`)).data);
  const utxo = z.object({ transaction_hash: z.string(), output_index: z.number(), fungible_token_amount: z.string(),
    locking_bytecode: z.string(), nonfungible_token_capability: z.enum(['none', 'mutable', 'minting']).nullable(),
    nonfungible_token_commitment: z.string().nullable() });
  const outputs = z.array(utxo).parse(envelope.parse(await get(`/v1/tokens/${args.category}/utxos?limit=500`)).data);
  assert.equal(outputs.length, category.utxo_count);
  assert.equal(outputs.reduce((sum, output) => sum + BigInt(output.fungible_token_amount), 0n).toString(), category.fungible_supply);
  assert.equal(outputs.filter(output => output.nonfungible_token_capability !== null).length, category.nft_count);
  assert.equal(outputs.filter(output => output.nonfungible_token_capability === 'minting').length, category.minting_count);
  for (const output of outputs) {
    const actual = z.object({ bestblock: hash, scriptPubKey: z.object({ hex }), tokenData: z.object({ category: hash, amount: z.string(),
      nft: z.object({ capability: z.string(), commitment: hex }).optional() }) })
      .parse(await rpc.call('gettxout', [hash.parse(output.transaction_hash.slice(2)), output.output_index, false]));
    assert.equal(actual.bestblock, ready.tip.hash);
    assert.equal(actual.tokenData.category, args.category);
    assert.equal(actual.tokenData.amount, output.fungible_token_amount);
    assert.equal(actual.scriptPubKey.hex, output.locking_bytecode.slice(2));
    assert.equal(actual.tokenData.nft?.capability ?? null, output.nonfungible_token_capability);
    assert.equal(actual.tokenData.nft === undefined ? null : `\\x${actual.tokenData.nft.commitment}`, output.nonfungible_token_commitment);
  }
  const txid = args.txid ?? category.genesis_txid;
  const transaction = z.object({ data: z.object({ inputs: z.array(z.object({ outpoint: z.object({ value_satoshis: z.string() }).nullable() })),
    hash: z.string() }) }).parse(await get(`/v1/bch/transactions/${txid}`));
  assert.equal(transaction.data.hash.slice(2), txid);
  assert.ok(transaction.data.inputs.some(input => input.outpoint !== null), 'No resolvable BCH prevout observed');
  for (const path of ['/v1/activity?limit=9', '/v1/status', '/v1/bch/height', '/v1/bch/blocks?limit=1', `/v1/bch/blocks/${ready.tip.hash}?limit=9`,
    `/v1/bch/transactions?ids=${txid}`, '/v1/bch/mempool?limit=9', `/v1/tokens/${args.category}/holders?limit=10`,
    `/v1/tokens/${args.category}/transactions?limit=10`, `/v1/tokens/${args.category}/genesis`, `/v1/tokens/${args.category}/supply`,
    `/v1/tokens/${args.category}/utxos?nft=true`, ...(outputs[0] === undefined ? [] : [
      `/v1/scripts/${outputs[0].locking_bytecode.slice(2)}/tokens`, `/v1/scripts/${outputs[0].locking_bytecode.slice(2)}/utxos?nft=true`])]) await get(path);
  const authchain = envelope.parse(await get(`/v1/tokens/${args.category}/authchain`));
  if (args['registry-file'] !== undefined) {
    const response = await fetch(new URL(`/v1/authchains/${args.category}/metadata/verify`, origin), { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content_base64: readFileSync(args['registry-file']).toString('base64') }),
      signal: AbortSignal.timeout(30000), redirect: 'error' });
    const content = z.object({ data: z.object({ status: z.literal('verified_content'), issuer_authority_verified: z.literal(false) }) }).parse(await response.json());
    assert.equal(content.data.status, 'verified_content');
  }
  const header = z.object({ hash, height: z.number().int(), time: z.number().int() }).parse(await rpc.call('getblockheader', [ready.tip.hash, true]));
  assert.equal(header.hash, ready.tip.hash);
  assert.equal(header.height, ready.tip.height);
  const tipAgeSeconds = Math.floor(Date.now() / 1000) - header.time;
  assert.ok(tipAgeSeconds >= -7200 && tipAgeSeconds <= config.MAX_CHIPNET_TIP_AGE_SECONDS, 'Canonical source tip is stale or future-dated');
  await rpc.call('getblockstats', [ready.tip.hash, ['totalfee']]);
  await rpc.call('getmempoolinfo');
  const peers = z.object({ connections: z.number().int().positive() }).parse(await rpc.call('getnetworkinfo'));
  if (config.RPC_PROXY_URL !== undefined) {
    const proxyRpc = new BitcoinRpc({ url: config.RPC_PROXY_URL });
    assert.equal(await proxyRpc.call('getblockhash', [0]), chipnetGenesis);
    assert.equal(await proxyRpc.call('getblockhash', [chipnetCheckpoint.height]), chipnetCheckpoint.hash);
    await verifyArchiveReadiness(proxyRpc, { height: before.blocks, hash: before.bestblockhash });
  }
  const after = z.object({ bestblockhash: hash, blocks: z.number() }).parse(await rpc.call('getblockchaininfo'));
  assert.equal(after.bestblockhash, before.bestblockhash, 'Node advanced during verification; wait for catch-up and remeasure reads');
  await verifyArchiveReadiness(historyRpc, { height: before.blocks, hash: before.bestblockhash });
  const report = { status: 'verified', measured_at: new Date().toISOString(), network: 'chipnet', rest_url: origin.origin,
    owner: { project: 'Blaze Indexer', host: hostname(), thread: 't3-thread://v2/cd548199-0437-465a-8ac9-7bbb4a94b98c/mcp:launch:02e5f777423e80c22415328bea9c31f0508bdd728a8ba9efb77442c89a8de5f8' },
    rpc: { url: config.RPC_PROXY_URL ?? null, access_route: config.RPC_PROXY_URL ?? null, credential_mechanism: 'Upstream credentials remain in private service configuration; server-to-server read proxy only.',
      supported_read_methods: config.RPC_PROXY_URL === undefined ? [] : readRpcMethods.options,
      verified_source_read_methods: readRpcMethods.options, archive_readiness: archive, test_only_write_route: null },
    identity: { genesis_hash: chipnetGenesis, checkpoint: { ...chipnetCheckpoint,
      provenance: 'https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/v29.2.0/src/chainparams.cpp#L1075', verified_against_endpoint: true } },
    tip: { ...ready.tip, synchronized: true, source_height: before.blocks, last_success_at: ready.last_success_at,
      timestamp: header.time, age_seconds: tipAgeSeconds, max_age_seconds: config.MAX_CHIPNET_TIP_AGE_SECONDS, connections: peers.connections },
    coverage: { indexed_start: ready.start_height, indexed_height: ready.tip.height, authchain: authchain.data },
    known_objects: { category: args.category, txid, nft: outputs.find(output => output.nonfungible_token_capability !== null) ?? null,
      locking_bytecode: outputs[0]?.locking_bytecode ?? null, address: null, resolvable_prevouts: true },
    resource_limits: { chain_sync_started_by_harness: false, full_chain_download: false,
      max_verified_category_utxos: 500, lifecycle: 'Owned running indexer; do not replace or stop foreign services.' },
    testnetFunctionalReady: false, publicReleaseReady: false,
    note: 'Verified backend sample/endpoint, not full project UI acceptance or an issuer authority certificate.' };
  mkdirSync('.build/reports', { recursive: true });
  writeReport('chipnet-acceptance', report);
  if (args['publish-connection']) writeFileSync('docs/chipnet-connection.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, network: report.network, rest_url: report.rest_url, category: args.category,
    indexed_height: ready.tip.height, report: '.build/reports/chipnet-acceptance.json', testnetFunctionalReady: false, publicReleaseReady: false }));
}
main().catch(cause => { console.error(cause instanceof IndexerError ? cause.message : 'Chipnet acceptance failed; check configuration, network pins, synchronization and bounded sample. No credentials are printed.'); process.exitCode = 1; });
