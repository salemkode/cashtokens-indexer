import { writeReport } from '../scripts/reports.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createReadProxy } from '../src/rpc-proxy.js';
import { verifyArchiveReadiness } from '../src/archive-readiness.js';
import { createTestBroadcast } from '../src/test-broadcast.js';
import { readFileSync, readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { ownedScenario } from './helpers/owned-scenario.js';
import { createApi } from '../src/api.js';
import { BitcoinRpc, ScopedTestRpc } from '../src/rpc.js';
import { TokenStore } from '../src/store.js';
import { syncOnce } from '../src/sync.js';
import { hash, hex, rpcTransaction } from '../src/model.js';
import { backupDatabase, restoreDatabase } from '../src/backup.js';

const binary = process.env.BCHN_TEST_BINARY;
test('real owned BCHN: token state, native prevouts, mempool, metadata-only authchain, reorg and backup',
  { skip: binary === undefined, timeout: 180000 }, async t => {
  assert.ok(binary);
  const node = await ownedScenario(binary);
  const path = join(node.directory, 'index.sqlite');
  const store = new TokenStore({ path, network: 'regtest', startHeight: 0, undoDepth: 10, authbases: [node.category] });
  const rpc = new BitcoinRpc({ url: `http://127.0.0.1:${node.port}`, cookieFile: node.cookiePath });
  const api = await createApi({ store, corsOrigins: [], rpc });
  const readProxy = createReadProxy(rpc, 'regtest');
  const policyPath = join(node.directory, 'test-approvals.json');
  const gateway = createTestBroadcast(new ScopedTestRpc({ url: `http://127.0.0.1:${node.port}`, cookieFile: node.cookiePath }, 'regtest'),
    policyPath, join(node.directory, 'test-journal.sqlite'));
  t.after(async () => { await readProxy.close(); await gateway.close(); await api.close(); store.close(); await node.close(); });
  const started = performance.now();
  const result = await syncOnce(store, rpc, { maxBlocks: 200 });
  assert.equal(result.tip?.height, 103);
  assert.equal(result.nodeReady, true);
  const archive = await verifyArchiveReadiness(rpc, { height: 103, hash: hash.parse(await node.call('getblockhash', [103])) });
  const indexed = await readProxy.inject({ method: 'POST', url: '/', payload: { id: 'archive', method: 'getindexinfo', params: ['txindex'] } });
  assert.deepEqual(indexed.json().result.txindex, archive.txindex);
  assert.equal(store.category(node.category)?.fungible_supply, '9007199254741000');
  assert.equal(store.category(node.category)?.nft_count, 3);
  assert.equal(store.category(node.category)?.minting_count, 1);
  assert.equal(store.listOutputs({ category: node.category }).length, 3);
  const detail = await api.inject(`/v1/bch/transactions/${node.genesisTxid}`);
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().data.inputs[0].outpoint.locking_bytecode.startsWith('\\x'), true);
  const blockHash = hash.parse(await node.call('getblockhash', [103]));
  const block = await api.inject(`/v1/bch/blocks/${blockHash}`);
  assert.equal(block.statusCode, 200, block.body);
  assert.equal(block.json().data.fee_satoshis, '1000');
  assert.equal(block.json().data.input_value_satoshis, node.genesisInputSatoshis);
  const genesis = await api.inject(`/v1/tokens/${node.category}/genesis`);
  assert.equal(genesis.statusCode, 200, genesis.body);
  assert.equal(genesis.json().data.outputs.length, 3);
  assert.equal(genesis.json().data.initial_spendable_supply, '9007199254741000');
  const supply = await api.inject(`/v1/tokens/${node.category}/supply`);
  assert.equal(supply.json().data.reserved_fungible_supply, '9007199254740993');
  assert.equal(supply.json().data.circulating_fungible_supply, '7');
  const metadata = await api.inject({ method: 'POST', url: `/v1/authchains/${node.category}/metadata/verify`,
    payload: { content_base64: Buffer.from(node.registry).toString('base64') } });
  assert.equal(metadata.statusCode, 200, metadata.body);
  assert.equal(metadata.json().data.status, 'verified_content');
  assert.equal(metadata.json().data.issuer_authority_verified, false);
  for (const output of store.listOutputs({ category: node.category })) {
    const actual = z.object({ tokenData: z.object({ amount: z.string(), category: hash }) })
      .parse(await node.call('gettxout', [output.transaction_hash.slice(2), output.output_index]));
    assert.equal(actual.tokenData.amount, output.fungible_token_amount);
    const proxied = await readProxy.inject({ method: 'POST', url: '/', payload: { id: 1, method: 'gettxout', params: [output.transaction_hash.slice(2), output.output_index] } });
    assert.equal(proxied.json().error, null);
    assert.equal(proxied.json().result.tokenData.amount, output.fungible_token_amount);
  }
  const lateStore = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 103 });
  await syncOnce(lateStore, rpc);
  const lateApi = await createApi({ store: lateStore, corsOrigins: [], rpc });
  t.after(async () => { await lateApi.close(); lateStore.close(); });
  const resolved = await lateApi.inject({ method: 'POST', url: `/v1/authchains/${node.category}/resolve`, payload: { max_blocks: 10 } });
  assert.equal(resolved.statusCode, 200, resolved.body);
  assert.equal(lateStore.resolved(node.category)?.coverage.method, 'targeted_native_scan');
  assert.equal(lateStore.resolved(node.category)?.authhead.txid, node.genesisTxid);
  const backup = join(node.directory, 'checkpoint.sqlite');
  await backupDatabase(path, backup);
  // Destroy the token-bearing identity output, then follow a pure BCH metadata migration.
  async function spend(previous: string, value: string, publish: boolean) {
    const raw = hex.parse(await node.call('createrawtransaction', [[{ txid: previous, vout: 0 }], [
      { [node.holder]: value }, ...(publish ? [{ data: ['42434d52', node.contentHash] }] : []),
    ]]));
    const signed = z.object({ hex, complete: z.literal(true) }).parse(await node.wallet('signrawtransactionwithwallet', [raw]));
    const decoded = rpcTransaction.parse(await node.call('decoderawtransaction', [signed.hex]));
    const capability = randomBytes(32).toString('hex');
    writeFileSync(policyPath, JSON.stringify({ network: 'regtest', genesis_hash: hash.parse(await node.call('getblockhash', [0])),
      dedicated_test_identity: true, max_fee_satoshis: '10000', capability, allowed_outpoints: [{ txid: previous, vout: 0 }],
      transactions: [{ txid: decoded.txid, hex: signed.hex, expires_at: new Date(Date.now() + 300000).toISOString() }] }), { mode: 0o600 });
    const response = await gateway.inject({ method: 'POST', url: '/', headers: { authorization: `Bearer ${capability}` },
      payload: { id: 'real-regtest', method: 'sendrawtransaction', params: [signed.hex] } });
    assert.equal(response.json().error, null, JSON.stringify(response.json().error));
    assert.equal(response.json().result, decoded.txid);
    return decoded.txid;
  }
  const burned = await spend(node.genesisTxid, '0.00008000', false);
  const pending = await api.inject('/v1/bch/mempool?limit=9');
  assert.equal(pending.statusCode, 200, pending.body);
  assert.ok(pending.json().data.unconfirmed_transactions.some((row: { transaction: { hash: string } }) => row.transaction.hash === `\\x${burned}`));
  assert.equal(store.category(node.category)?.fungible_supply, '9007199254741000');
  await node.call('generatetoaddress', [1, node.address]);
  await syncOnce(store, rpc);
  assert.equal(store.category(node.category)?.fungible_supply, '7');
  const activity = await api.inject('/v1/activity?limit=9');
  assert.equal(activity.statusCode, 200, activity.body);
  assert.equal(activity.json().data[0].txid, burned);
  assert.equal(activity.json().data[0].categories[0].fungible_burned, '9007199254740993');
  assert.equal(activity.json().data[0].categories[0].fungible_delta, '-9007199254740993');
  await syncOnce(lateStore, rpc);
  assert.equal(lateStore.resolved(node.category)?.authhead.txid, burned);
  const updated = await spend(burned, '0.00006000', true);
  await node.call('generatetoaddress', [1, node.address]);
  await syncOnce(store, rpc);
  await syncOnce(lateStore, rpc);
  assert.equal(lateStore.resolved(node.category)?.authhead.txid, updated);
  const chain = store.authchain(node.category);
  assert.ok(chain.authhead);
  assert.equal(chain.authhead.txid, updated);
  assert.equal(chain.latest_publication?.txid, updated);
  const afterMetadata = (await api.inject('/v1/activity')).json();
  assert.equal(afterMetadata.data[0].txid, burned); // Pure BCH metadata update is explicitly excluded.
  assert.equal(afterMetadata.snapshot.hash, store.tip()?.hash);
  const nonCategory = await api.inject(`/v1/authchains/${node.genesisTxid}`);
  assert.equal(nonCategory.statusCode, 200, nonCategory.body);
  assert.equal(nonCategory.json().data.authhead.txid, updated);
  const orphan = hash.parse(await node.call('getblockhash', [104]));
  await node.call('invalidateblock', [orphan]);
  const rollback = await syncOnce(store, rpc);
  assert.equal(rollback.rolledBack, 2);
  await syncOnce(lateStore, rpc);
  assert.equal(lateStore.resolved(node.category), null);
  assert.equal(store.category(node.category)?.fungible_supply, '9007199254741000');
  assert.equal(store.authchain(node.category).authhead?.txid, node.genesisTxid);
  await node.call('reconsiderblock', [orphan]);
  await syncOnce(store, rpc);
  assert.equal(store.category(node.category)?.fungible_supply, '7');
  const restored = join(node.directory, 'restored.sqlite');
  await restoreDatabase(backup, restored);
  const recovered = new TokenStore({ path: restored, network: 'regtest', startHeight: 0, authbases: [node.category] });
  try {
    assert.equal(recovered.category(node.category)?.fungible_supply, '9007199254741000');
    await syncOnce(recovered, rpc);
    assert.equal(recovered.category(node.category)?.fungible_supply, '7');
  } finally { recovered.close(); }
  const sourceHash = createHash('sha256');
  for (const name of readdirSync('src').filter(name => /\.(ts|json)$/.test(name)).sort()) sourceHash.update(name).update(readFileSync(join('src', name)));
  const nodeVersion = z.object({ subversion: z.string(), version: z.number() }).parse(await node.call('getnetworkinfo'));
  const report = { runtime_source_sha256: sourceHash.digest('hex'), test_runtime: process.version, observed_at: new Date().toISOString(), network: 'regtest', isolated: true, peers: 0, node: nodeVersion,
    archive_readiness_at_initial_snapshot: archive,
    category: node.category, genesis_txid: node.genesisTxid, metadata_txid: updated, address: node.holder,
    tip: store.tip(), elapsed_ms: performance.now() - started, sqlite_bytes: statSync(path).size,
    wal_bytes: statSync(`${path}-wal`).size, rss_bytes: process.memoryUsage().rss,
    assertions: ['BCHN consensus accepted tokens', 'unpruned txindex synced at measured height via getindexinfo', 'native prevouts', 'confirmed supply/reserve/genesis and NFTs', 'committed metadata integrity/schema', 'mempool',
      'metadata-only update', 'approved exact-byte test gateway', 'non-category authbase', 'bounded historical authbase resolution and watch/reorg invalidation', 'global activity including input-only burn', 'invalidate/reconsider reorg', 'online backup/restore catch-up'] };
  mkdirSync('.build/reports', { recursive: true });
  writeReport('regtest-acceptance', report);
});
