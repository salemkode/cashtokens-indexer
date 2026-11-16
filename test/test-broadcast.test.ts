import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestBroadcast } from '../src/test-broadcast.js';
import { IndexerError } from '../src/model.js';

function txid(bytes: string) { return createHash('sha256').update(createHash('sha256').update(Buffer.from(bytes, 'hex')).digest()).digest().reverse().toString('hex'); }

test('approved test gateway binds bytes/network/inputs/capability and persists ambiguous submissions without automatic resends', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'blaze-test-gateway-'));
  const path = join(directory, 'policy.json');
  const journal = join(directory, 'journal.sqlite');
  const bytes = '00'.repeat(60);
  const hash = txid(bytes);
  const capability = randomBytes(32).toString('hex');
  const grant = { network: 'regtest', genesis_hash: '1'.repeat(64), dedicated_test_identity: true, max_fee_satoshis: '5000', capability,
    allowed_outpoints: [{ txid: '2'.repeat(64), vout: 0 }],
    transactions: [{ txid: hash, hex: bytes, expires_at: new Date(Date.now() + 300000).toISOString() }] };
  writeFileSync(path, JSON.stringify(grant), { mode: 0o600 });
  const state = { sends: 0, visible: false, wrongNetwork: false, excessiveFee: false };
  const rpc = { network: 'regtest' as const, async call(method: string) {
    if (method === 'getblockchaininfo') return { chain: state.wrongNetwork ? 'main' : 'regtest', blocks: 103, initialblockdownload: false };
    if (method === 'getblockhash') return '1'.repeat(64);
    if (method === 'decoderawtransaction') return { txid: hash, vin: [{ txid: '2'.repeat(64), vout: 0 }], vout: [{ value: state.excessiveFee ? 0 : 0.00009 }] };
    if (method === 'gettxout') return { value: 0.0001 };
    if (method === 'testmempoolaccept') return [{ allowed: true }];
    if (method === 'getrawtransaction' && state.visible) return { txid: hash };
    if (method === 'sendrawtransaction') { state.sends += 1; throw new IndexerError({ message: 'Simulated lost response after submission' }); }
    throw new IndexerError({ message: 'Not observed' });
  } };
  const request = { method: 'POST' as const, url: '/', headers: { authorization: `Bearer ${capability}` },
    payload: { id: 1, method: 'sendrawtransaction', params: [bytes] } };
  const first = createTestBroadcast(rpc, path, journal);
  try {
    assert.equal((await first.inject({ ...request, headers: {} })).statusCode, 403);
    state.wrongNetwork = true;
    assert.equal((await first.inject(request)).json().error.code, -32002);
    state.wrongNetwork = false;
    state.excessiveFee = true;
    assert.equal((await first.inject(request)).json().error.code, -32003);
    assert.equal(state.sends, 0);
    state.excessiveFee = false;
    chmodSync(path, 0o644);
    assert.equal((await first.inject(request)).json().error.code, -32000);
    chmodSync(path, 0o600);
    assert.equal((await first.inject(request)).json().error.code, -32020);
    assert.equal(state.sends, 1);
    assert.equal((await first.inject(request)).json().error.code, -32020);
    assert.equal(state.sends, 1);
  } finally { await first.close(); }
  const restarted = createTestBroadcast(rpc, path, journal);
  try {
    assert.equal((await restarted.inject(request)).json().error.code, -32020);
    assert.equal(state.sends, 1);
    state.visible = true;
    assert.equal((await restarted.inject(request)).json().result, hash);
    assert.equal(state.sends, 1);
    writeFileSync(path, JSON.stringify({ ...grant, transactions: [{ ...grant.transactions[0], expires_at: '2000-01-01T00:00:00.000Z' }] }));
    assert.equal((await restarted.inject(request)).json().error.code, -32003);
  } finally { await restarted.close(); rmSync(directory, { recursive: true, force: true }); }
});
