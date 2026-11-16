import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../src/api.js';
import { TokenStore } from '../src/store.js';

const category = 'a'.repeat(64);
const txid = '1'.repeat(64);
const script = '76a914' + '12'.repeat(20) + '88ac';
const otherScript = '51';
const originalAmount = '9007199254740993';

function fixture() {
  const store = new TokenStore({ path: ':memory:', network: 'mainnet', startHeight: 0 });
  store.applyBlock({ hash: '0'.repeat(64), height: 0, time: 1700000000, tx: [{
    txid, vin: [{ coinbase: '00' }], vout: [
      { n: 0, value: 0.00001, scriptPubKey: { hex: script }, tokenData: { category, amount: originalAmount } },
      { n: 1, value: 0.00001, scriptPubKey: { hex: script }, tokenData: { category, amount: '0', nft: { capability: 'none', commitment: '' } } },
      { n: 2, value: 0.00001, scriptPubKey: { hex: otherScript }, tokenData: { category, amount: '5', nft: { capability: 'mutable', commitment: 'abcd' } } },
      { n: 3, value: 0.00001, scriptPubKey: { hex: otherScript }, tokenData: { category, amount: '0', nft: { capability: 'minting', commitment: '' } } },
    ],
  }] });
  return store;
}

test('REST keeps integer amounts exact, aggregates holders, and bounds pagination', async t => {
  const store = fixture();
  const api = await createApi({ store, corsOrigins: ['https://explorer.salemkode.com'] });
  t.after(async () => { await api.close(); store.close(); });
  const token = await api.inject(`/v1/tokens/${category}`);
  assert.equal(token.statusCode, 200);
  assert.equal(token.json().data.fungible_supply, '9007199254740998');
  assert.equal(token.json().data.nft_count, 3);
  assert.equal(token.json().confirmed_only, true);
  const holders = (await api.inject(`/v1/tokens/${category}/holders?limit=1`)).json();
  assert.equal(holders.data.length, 1);
  assert.equal(holders.data[0].fungible_token_amount, originalAmount);
  assert.equal(holders.data[0].nft_count, 1);
  const balance = (await api.inject(`/v1/scripts/${script}/tokens`)).json();
  assert.equal(balance.data[0].fungible_token_amount, originalAmount);
  assert.equal((await api.inject('/v1/tokens?limit=501')).statusCode, 400);
  assert.equal((await api.inject('/v1/tokens?offset=-1')).statusCode, 400);
  assert.equal((await api.inject('/v1/tokens/not-a-category')).statusCode, 400);
  assert.equal((await api.inject(`/v1/tokens/${'f'.repeat(64)}`)).statusCode, 404);
  const cors = await api.inject({ url: '/v1/status', headers: { origin: 'https://explorer.salemkode.com' } });
  assert.equal(cors.headers['access-control-allow-origin'], 'https://explorer.salemkode.com');
  const foreign = await api.inject({ url: '/v1/status', headers: { origin: 'https://attacker.example' } });
  assert.equal(foreign.headers['access-control-allow-origin'], undefined);
});

test('REST NFT filters support token and script UTXOs including long locking bytecode', async t => {
  const store = fixture();
  const api = await createApi({ store, corsOrigins: [] });
  t.after(async () => { await api.close(); store.close(); });
  const nft = (await api.inject(`/v1/tokens/${category}/utxos?nft=true`)).json();
  assert.equal(nft.data.length, 3);
  assert.equal(nft.indexed_height, 0);
  const ft = (await api.inject(`/v1/tokens/${category}/utxos?nft=false`)).json();
  assert.equal(ft.data.length, 1);
  const minting = (await api.inject(`/v1/tokens/${category}/utxos?capability=minting`)).json();
  assert.equal(minting.data.length, 1);
  assert.equal((await api.inject(`/v1/tokens/${category}/utxos?nft=1`)).statusCode, 400);
  const addressNfts = (await api.inject(`/v1/scripts/${script}/utxos?nft=true`)).json();
  assert.equal(addressNfts.data.length, 1);
  assert.equal((await api.inject(`/v1/scripts/${'51'.repeat(51)}/tokens`)).statusCode, 200);
  assert.equal((await api.inject(`/v1/scripts/${'51'.repeat(10000)}/utxos`)).statusCode, 200);
});


test('REST history includes complete burns and no legacy GraphQL upstream exists', async t => {
  const store = fixture();
  store.applyBlock({ hash: '2'.repeat(64), previousblockhash: '0'.repeat(64), height: 1, time: 1700000600, tx: [{
    txid: '3'.repeat(64), vin: [{ txid, vout: 0 }],
    vout: [{ n: 0, value: 0.000009, scriptPubKey: { hex: '51' } }],
  }] });
  const api = await createApi({ store, corsOrigins: [] });
  t.after(async () => { await api.close(); store.close(); });
  const response = await api.inject(`/v1/tokens/${category}/transactions`);
  assert.equal(response.json().data.length, 2);
  assert.equal(response.json().data[0].transaction.hash, '\\x' + '3'.repeat(64));
  assert.equal(response.json().data[0].fungible_delta, '-' + originalAmount);
  const removed = await api.inject({ method: 'POST', url: '/v1/graphql', payload: { query: '{ node { name } }' } });
  assert.equal(removed.statusCode, 404);
});
