// Future explicit bounded runner worker only. Never run this to wait for resources.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { createApi } from '../dist/src/api.js';
import { BitcoinRpc } from '../dist/src/rpc.js';
import { TokenStore } from '../dist/src/store.js';
import { syncOnce } from '../dist/src/sync.js';
import { acquireWriter } from '../dist/src/ownership.js';
import { activityEnvelope } from '../dist/src/activity-contract.js';
import { boundedHandoff, measuredIsolation } from './bounded-regtest-contract.mjs';
import { publishHandoff } from './atomic-handoff.mjs';
import { fundingPlan, preRuleState, boundedMineCount, nativeFundingMaturity, PreviewProfileError } from './preview-regtest-profile.mjs';

async function main() {
  const run = resolve(z.string().min(1).parse(process.argv[process.argv.indexOf('--run') + 1]));
  const config = z.object({ run: z.string(), data: z.string(), rpc_port: z.number().int(), cookie: z.string(), expires_at_epoch: z.number(), genesis: z.string(), source_commit: z.string() }).parse(JSON.parse(readFileSync(join(run, 'worker-input.json'), 'utf8')));
  assert.equal(config.run, run);
  const registrationDeadline = Date.now() + 5000;
  while (!existsSync(join(run, 'consumer-owner.json')) && Date.now() < registrationDeadline) await setTimeout(20);
  const registration = z.object({ pid: z.literal(process.pid), role: z.literal('consumer'), profile: z.literal('bounded_consumer_regtest_v1') }).parse(JSON.parse(readFileSync(join(run, 'consumer-owner.json'), 'utf8')));
  assert.equal(registration.pid, process.pid);
  const controller = new AbortController();
  function alive() {
    assert.ok(Date.now() < config.expires_at_epoch * 1000);
    assert.ok(Date.now() - statSync(join(run, 'parent-heartbeat.jsonl')).mtimeMs <= 2500);
    assert.ok(!existsSync(join(run, 'stop-request.json')));
  }
  const timer = setInterval(() => { try { alive(); } catch { controller.abort(); } }, 500);
  process.once('SIGTERM', () => controller.abort()); process.once('SIGINT', () => controller.abort());
  const txid = raw => Buffer.from(createHash('sha256').update(createHash('sha256').update(Buffer.from(raw, 'hex')).digest()).digest()).reverse().toString('hex');
  async function call(method, params = [], wallet = false) {
    alive();
    const auth = readFileSync(config.cookie, 'utf8').trim();
    const response = await fetch(`http://127.0.0.1:${config.rpc_port}${wallet ? '/wallet/bounded-regtest' : ''}`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(auth).toString('base64')}` },
      body: JSON.stringify({ id: 'owned-bounded-regtest', method, params }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]) });
    const result = z.object({ result: z.unknown(), error: z.unknown().nullable() }).parse(await response.json());
    assert.equal(result.error, null, 'Owned regtest RPC failed; no retry'); return result.result;
  }
  const rpc = new BitcoinRpc({ url: `http://127.0.0.1:${config.rpc_port}`, cookieFile: config.cookie, timeoutMs: 2000 }, controller.signal);
  const holder = { app: null, store: null, release: null };
  try {
    const initialChain = await call('getblockchaininfo');
    const nativeNetwork = await call('getnetworkinfo');
    assert.equal(initialChain.chain, 'regtest');
    assert.equal(await call('getblockhash', [0]), config.genesis); assert.equal(nativeNetwork.connections, 0);
    const horizon = () => Math.max(Math.ceil(Date.now() / 1000), Math.ceil(config.expires_at_epoch));
    const plan = fundingPlan({ commit: config.source_commit, version: nativeNetwork.version, chain: initialChain, nowEpoch: Math.floor(Date.now() / 1000), leaseEndsEpoch: horizon() });
    writeFileSync(join(run, 'fixture-source-profile.json'), JSON.stringify({ plan, initial_native_state: preRuleState(initialChain, horizon()), evidence_scope: 'owned regtest native profile only' }), { flag: 'wx', mode: 0o600 });
    const generation = { count: 0 };
    async function mine(count, address) {
      preRuleState(await call('getblockchaininfo'), horizon());
      const total = boundedMineCount(generation.count, count, plan);
      const hashes = await call('generatetoaddress', [count, address]); assert.equal(hashes.length, count); generation.count = total;
      const state = preRuleState(await call('getblockchaininfo'), horizon()); assert.equal(state.blocks, total);
    }
    await call('createwallet', ['bounded-regtest']);
    const address = z.string().startsWith('bchreg:').parse(await call('getnewaddress', [], true));
    await mine(plan.funding_blocks, address);
    nativeFundingMaturity(await call('getblockchaininfo'), horizon());
    const firstCoinBlock = await call('getblock', [await call('getblockhash', [1]), 1]);
    const matureCoin = await call('gettxout', [firstCoinBlock.tx[0], 0, true]);
    assert.equal(matureCoin.coinbase, true); assert.equal(matureCoin.confirmations, plan.funding_blocks);
    const category = z.string().regex(/^[0-9a-f]{64}$/).parse(await call('sendtoaddress', [address, 1], true));
    await mine(1, address);
    const parentRaw = await call('getrawtransaction', [category]); assert.equal(txid(parentRaw), category);
    const parent = await call('decoderawtransaction', [parentRaw]); const previous = parent.vout.find(output => output.n === 0); assert.ok(previous);
    const changeSats = BigInt(previous.value.toFixed(8).replace('.', '')) - 31000n;
    const changeBch = `${changeSats / 100000000n}.${(changeSats % 100000000n).toString().padStart(8, '0')}`;
    const addresses = await Promise.all(Array.from({ length: 3 }, () => call('getnewaddress', [], true)));
    const publication = createHash('sha256').update(JSON.stringify({ version: { major: 0, minor: 1, patch: 0 }, latestRevision: '2026-11-15T00:00:00.000Z', registryIdentity: { name: 'Owned bounded regtest' } })).digest('hex');
    const raw = await call('createrawtransaction', [[{ txid: category, vout: 0 }], [
      { [addresses[0]]: { amount: '0.00010000', tokenData: { category, amount: '9007199254740993', nft: { capability: 'mutable', commitment: '' } } } },
      { [addresses[1]]: { amount: '0.00010000', tokenData: { category, amount: '0', nft: { capability: 'minting', commitment: '' } } } },
      { [addresses[2]]: { amount: '0.00010000', tokenData: { category, amount: '7', nft: { capability: 'none', commitment: 'abcd' } } } },
      { [address]: changeBch }, { data: ['42434d52', publication, Buffer.from('example.invalid').toString('hex')] },
    ]]);
    async function submit(raw, label) {
      const signed = z.object({ hex: z.string(), complete: z.literal(true) }).parse(await call('signrawtransactionwithwallet', [raw], true));
      const expected = txid(signed.hex); const decoded = await call('decoderawtransaction', [signed.hex]); assert.equal(decoded.txid, expected);
      assert.equal(decoded.locktime, 0); assert.ok(decoded.vin.every(input => (input.sequence >>> 31) === 1), 'Fixture must not assume height-based BIP68 semantics');
      assert.equal((await call('testmempoolaccept', [[signed.hex]]))[0].allowed, true);
      writeFileSync(join(run, `${label}-submission.json`), JSON.stringify({ txid: expected, exact_hex: signed.hex, network: 'regtest', automatic_retry: false }), { flag: 'wx', mode: 0o600 });
      assert.equal(await call('sendrawtransaction', [signed.hex]), expected); return decoded;
    }
    const issuance = await submit(raw, 'issuance'); await mine(1, address);
    const burnInput = issuance.vout.find(output => output.n === 0); assert.equal(burnInput.tokenData.amount, '9007199254740993');
    const burnRaw = await call('createrawtransaction', [[{ txid: issuance.txid, vout: 0 }], [{ [addresses[0]]: '0.00008000' }]]);
    const burn = await submit(burnRaw, 'burn'); assert.ok(burn.vout.every(output => output.tokenData === undefined));
    await mine(1, address);
    const source = await call('getblockchaininfo'); assert.equal(source.blocks, plan.expected_final_height);
    const expectedRows = [
      { txid: burn.txid, category, fungible_delta: `-${burnInput.tokenData.amount}`, fungible_issued: '0', fungible_burned: burnInput.tokenData.amount, category_history_complete: true, gross_fungible_details_complete: true },
      { txid: issuance.txid, category, fungible_delta: issuance.vout.filter(output => output.tokenData?.category === category).reduce((sum, output) => sum + BigInt(output.tokenData.amount), 0n).toString(), fungible_issued: issuance.vout.filter(output => output.tokenData?.category === category).reduce((sum, output) => sum + BigInt(output.tokenData.amount), 0n).toString(), fungible_burned: '0', category_history_complete: true, gross_fungible_details_complete: true },
    ];
    const database = join(config.data, 'consumer-index.sqlite'); holder.release = acquireWriter(database);
    holder.store = new TokenStore({ path: database, network: 'regtest', startHeight: 0, undoDepth: 10, authbases: [] });
    const result = await syncOnce(holder.store, rpc, { maxBlocks: plan.total_generated_block_cap + 1, expectedGenesisHash: config.genesis });
    assert.equal(result.nodeReady, true); assert.equal(result.tip.height, source.blocks); assert.equal(result.tip.hash, source.bestblockhash);
    holder.app = await createApi({ store: holder.store, corsOrigins: [], rpc, tokenRpc: rpc });
    const runtime = { lastSuccess: Date.now(), healthy: true };
    holder.app.get('/readyz', (_request, reply) => reply.code(runtime.healthy && !controller.signal.aborted && Date.now() - runtime.lastSuccess < 5000 ? 200 : 503).send({ ...holder.store.status(), state: runtime.healthy ? 'synced' : 'error', node_ready: runtime.healthy, source_height: source.blocks, last_success_at: new Date(runtime.lastSuccess).toISOString(), last_error: null }));
    const activity = activityEnvelope.parse((await holder.app.inject('/v1/activity?limit=50&offset=0')).json());
    assert.equal(activity.network, 'regtest'); assert.equal(activity.indexed_height, source.blocks); assert.equal(activity.snapshot.hash, source.bestblockhash);
    assert.equal(activity.coverage.start_height, 0); assert.equal(activity.coverage.token_state.status, 'complete_at_indexed_tip');
    for (const expected of expectedRows) {
      const movement = activity.data.find(row => row.txid === expected.txid)?.categories.find(row => row.category === category); assert.ok(movement);
      for (const key of ['fungible_delta', 'fungible_issued', 'fungible_burned', 'category_history_complete', 'gross_fungible_details_complete']) assert.equal(movement[key], expected[key]);
    }
    const page = (await holder.app.inject(`/v1/activity?limit=1&offset=1&snapshot_hash=${activity.snapshot.hash}`)).json(); assert.equal(page.data[0].txid, issuance.txid);
    const detail = (await holder.app.inject(`/v1/bch/transactions/${issuance.txid}`)).json();
    const expectedOutput = { output_index: previous.n, value_satoshis: BigInt(previous.value.toFixed(8).replace('.', '')).toString(), locking_bytecode: previous.scriptPubKey.hex };
    assert.equal(detail.data.inputs[0].outpoint.value_satoshis, expectedOutput.value_satoshis);
    assert.equal(detail.data.inputs[0].outpoint.locking_bytecode, `\\x${expectedOutput.locking_bytecode}`);
    const endpoint = await holder.app.listen({ host: '127.0.0.1', port: 0 });
    const readyResponse = await fetch(`${endpoint}/readyz`, { signal: AbortSignal.timeout(2000) });
    assert.equal(readyResponse.status, 200);
    const measuredReady = await readyResponse.json(); assert.equal(measuredReady.genesis_hash, config.genesis); assert.equal(measuredReady.schema_version, 4); assert.equal(measuredReady.tip.hash, source.bestblockhash); assert.equal(measuredReady.tip.height, source.blocks);
    const isolationFacts = { chain: (await call('getblockchaininfo')).chain, genesis: await call('getblockhash', [0]), argv: JSON.parse(readFileSync(join(run, 'owner.json'), 'utf8')).identity.command.split(/\s+/), connection_count: await call('getconnectioncount'), peer_info: await call('getpeerinfo') };
    const profile = measuredIsolation(isolationFacts);
    writeFileSync(join(run, 'isolation-observation.json'), JSON.stringify({ measured_at: new Date().toISOString(), chain: isolationFacts.chain, genesis: isolationFacts.genesis, connection_count: isolationFacts.connection_count, peer_info_count: isolationFacts.peer_info.length, owned_no_peer_argv_verified: true }), { flag: 'wx', mode: 0o600 });
    const measuredAt = new Date();
    const connection = boundedHandoff.parse({ status: 'verified', network: 'regtest', measured_at: measuredAt.toISOString(), expires_at: new Date(config.expires_at_epoch * 1000).toISOString(), rest_url: endpoint,
      profile, resource_gate: JSON.parse(readFileSync(join(run, 'consumer-resource-gate.json'), 'utf8')),
      ready: { ...holder.store.status(), genesis_hash: config.genesis }, category, txid: issuance.txid, address: addresses[0], prevout: { resolvable: true, expected_output: expectedOutput },
      activity: { coverage: { start_height: activity.coverage.start_height, token_state_status: activity.coverage.token_state.status, gross_fungible_details_start: activity.coverage.gross_fungible_details_start }, expected_rows: expectedRows },
      acceptance_complete: true, snapshot409: 'NOT_EXECUTED: no owner snapshot mutation' });
    alive(); assert.equal((await call('getblockchaininfo')).bestblockhash, connection.ready.tip.hash);
    publishHandoff(run, 'connection.json', connection);
    while (!controller.signal.aborted) {
      try { alive(); const current = await call('getblockchaininfo'); assert.equal(current.bestblockhash, connection.ready.tip.hash); runtime.lastSuccess = Date.now(); }
      catch { runtime.healthy = false; controller.abort(); }
      try { await setTimeout(500, undefined, { signal: controller.signal }); } catch { /* Owned stop. */ }
    }
  } finally {
    clearInterval(timer); controller.abort(); await holder.app?.close(); holder.store?.close(); holder.release?.();
  }
}
main().catch(cause => { console.error(cause instanceof PreviewProfileError ? `Unsupported preview regtest fixture profile: ${cause.code}` : 'Bounded REGTEST worker failed; no retry or external network provision.'); process.exitCode = 1; });
