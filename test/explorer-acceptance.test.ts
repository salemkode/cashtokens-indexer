import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createApi } from '../src/api.js';
import { TokenStore } from '../src/store.js';
import { syncOnce } from '../src/sync.js';
import { RpcResponseError } from '../src/rpc.js';
import { alice, bob, block, id, output, tx } from './fixtures.js';

/** One workload, not a modified explorer: original 15 application-referenced query requirements. */
test('original explorer query acceptance on a bounded BCHN-shaped workload', async t => {
  const store = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 0 });
  const root = tx(100, [{ n: 0, value: 0.0001, scriptPubKey: { hex: alice } }]);
  const genesis = tx(101, [output(id(100), '9007199254740993'),
    output(id(100), '7', alice), output(id(100), '0', bob, { capability: 'minting', commitment: '' }),
    output(id(100), '0', alice, { capability: 'none', commitment: 'abcd' })], [{ txid: id(100), vout: 0 }]);
  const burn = tx(102, [{ n: 0, value: 0.000005, scriptPubKey: { hex: bob } }], [{ txid: id(101), vout: 1 }]);
  const metadata = tx(103, [{ n: 0, value: 0.000006, scriptPubKey: { hex: bob } },
    { n: 1, value: 0, scriptPubKey: { hex: `6a0442434d5220${'55'.repeat(32)}` } }], [{ txid: id(101), vout: 0 }]);
  const chain = [block(0, [root]), block(1, [genesis]), block(2, [burn, metadata])];
  const pending = tx(104, [{ n: 0, value: 0.000004, scriptPubKey: { hex: alice } }], [{ txid: id(102), vout: 0 }]);
  const all = [...chain.flatMap(value => value.tx), pending];
  const rpc = { async call(method: string, params: unknown[] = []) {
    if (method === 'getblockchaininfo') return { chain: 'regtest', blocks: 2, pruned: false };
    if (method === 'getblockhash') return id(1000 + Number(params[0]));
    if (method === 'getnetworkinfo') return { subversion: '/Bitcoin Cash Node:fixture/' };
    if (method === 'getrawmempool') return { [id(104)]: { time: 1700000003 } };
    if (method === 'getblockstats') return { totalfee: 0.000005 };
    const requested = chain.find(value => value.hash === params[0]);
    if (method === 'getblockheader' && requested) return { ...requested, confirmations: 3 - requested.height, nTx: requested.tx.length };
    if (method === 'getblock' && requested) return { ...requested, size: 1234 + requested.height,
      confirmations: 3 - requested.height, ...(params[1] === 1 ? { tx: requested.tx.map(value => value.txid) } : {}) };
    if (method === 'getrawtransaction') {
      const value = all.find(value => value.txid === params[0]);
      if (!value) throw new RpcResponseError(method, -5);
      const included = chain.find(block => block.tx.some(tx => tx.txid === value.txid));
      return { ...value, ...(included ? { blockhash: included.hash, confirmations: 3 - included.height } : { confirmations: 0 }) };
    }
    throw new RpcResponseError(method, -5);
  } };
  const sync = await syncOnce(store, rpc);
  assert.equal(sync.indexed, 3);
  const api = await createApi({ store, corsOrigins: [], rpc });
  t.after(async () => { await api.close(); store.close(); });
  async function get(url: string) {
    const response = await api.inject(url);
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
    return response.json().data;
  }
  const requirements = {
    async GetLastBlock() { assert.equal((await get('/v1/bch/height')).height, 2); },
    async GetBlocks() {
      const blocks = await get('/v1/bch/blocks?limit=1');
      assert.equal(blocks[0].height, 2); assert.equal(blocks[0].size_bytes, 1236);
      assert.equal(blocks[0].transaction_count, 2); assert.equal(blocks[0].timestamp, 1700000002);
    },
    async GetBlock() {
      const block = await get('/v1/bch/blocks/2?limit=1&offset=1');
      assert.equal(block.transactions.length, 1); assert.equal(block.transactions[0].transaction.hash, `\\x${id(103)}`);
      assert.equal(block.input_count, 2); assert.equal(block.output_count, 3);
      assert.equal(block.output_value_satoshis, '1100');
    },
    async GetTx() {
      const tx = await get(`/v1/bch/transactions/${id(103)}`);
      assert.equal(tx.inputs[0].outpoint.fungible_token_amount, '9007199254740993');
      assert.equal(tx.outputs[0].locking_bytecode, `\\x${bob}`);
      assert.equal(tx.block_inclusions[0].block.height, 2);
    },
    async GetTransactions() {
      const txs = await get(`/v1/bch/transactions?ids=${id(103)},${id(101)}`);
      assert.deepEqual(txs.map((tx: { hash: string }) => tx.hash), [`\\x${id(103)}`, `\\x${id(101)}`]);
    },
    async MonitorMempools() {
      const pool = await get('/v1/bch/mempool?limit=9');
      assert.equal(pool.unconfirmed_transaction_count, 1);
      assert.equal(pool.unconfirmed_transactions[0].transaction.inputs[0].outpoint.locking_bytecode, `\\x${bob}`);
      assert.equal(pool.unconfirmed_transactions[0].validated_at, '2023-11-14T22:13:23.000Z');
    },
    async GetTokenAddress() {
      const holders = await get(`/v1/tokens/${id(100)}/holders?limit=1`);
      assert.equal(holders[0].locking_bytecode, `\\x${alice}`); assert.equal(holders[0].nft_count, 1);
    },
    async GetTokenTxs() {
      const history = await get(`/v1/tokens/${id(100)}/transactions`);
      assert.equal(history.length, 3);
      assert.equal(history[0].transaction.hash, `\\x${id(103)}`);
      assert.equal(history[0].fungible_delta, '-9007199254740993');
      assert.equal(history[1].transaction.hash, `\\x${id(102)}`);
      assert.equal(history[1].fungible_delta, '-7');
    },
    async GetTokenChild() {
      const nfts = await get(`/v1/tokens/${id(100)}/utxos?nft=true`);
      assert.equal(nfts.length, 2);
      assert.deepEqual(new Set(nfts.map((nft: { nonfungible_token_capability: string }) => nft.nonfungible_token_capability)), new Set(['none', 'minting']));
    },
    async GetAddressNFTs() {
      const nfts = await get(`/v1/scripts/${alice}/utxos?nft=true`);
      assert.equal(nfts[0].nonfungible_token_commitment, '\\xabcd');
      assert.equal(nfts[0].transaction_hash, `\\x${id(101)}`);
    },
    async GetAddressTokens() {
      const holdings = await get(`/v1/scripts/${bob}/tokens`);
      assert.equal(holdings[0].category, id(100)); assert.equal(holdings[0].nft_count, 1);
    },
    async GetUseNonBurnTokens() { assert.equal((await get(`/v1/tokens/${id(100)}`)).fungible_supply, '0'); },
    async GetSupplyNFTs() { assert.equal((await get(`/v1/tokens/${id(100)}`)).nft_count, 2); },
    async GetMintingToken() { assert.equal((await get(`/v1/tokens/${id(100)}`)).minting_count, 1); },
    async GetAuthChains() {
      const chain = await get(`/v1/tokens/${id(100)}/authchain`);
      assert.equal(chain.authbase, id(100)); assert.equal(chain.authhead.txid, id(103));
      assert.equal(chain.latest_publication.txid, id(103)); assert.equal(chain.latest_publication.content_hash, '55'.repeat(32));
      assert.equal(chain.metadata_content_verified, false); assert.equal(chain.discovery_only, true);
      assert.equal(chain.coverage.indexed_height, 2);
    },
  };
  const inventory = z.object({ operations: z.array(z.object({ name: z.string(), referenced_by_app: z.boolean() })) })
    .parse(JSON.parse(readFileSync(new URL('../docs/explorer-original-workload.json', import.meta.url), 'utf8')));
  assert.deepEqual(Object.keys(requirements).sort(), inventory.operations.filter(operation => operation.referenced_by_app).map(operation => operation.name).sort());
  for (const [name, check] of Object.entries(requirements)) await t.test(name, check);
});
