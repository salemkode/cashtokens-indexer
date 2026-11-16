// In-memory SYNTHETIC validation fixtures only. Never emitted as measured handoffs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedHandoff } from '../scripts/bounded-regtest-contract.mjs';
function synthetic() {
  const category = 'a'.repeat(64);
  const row = { txid: 'b'.repeat(64), category, fungible_delta: '9007199254741000', fungible_issued: '9007199254741000', fungible_burned: '0', category_history_complete: true, gross_fungible_details_complete: true };
  return { status: 'verified', network: 'regtest', measured_at: '2026-11-15T00:00:00.000Z', expires_at: '2026-11-15T00:10:00.000Z', rest_url: 'http://127.0.0.1:12345', profile: { isolated: true, peers: 0 }, resource_gate: { passed: true, normal_pressure: true },
    ready: { genesis_hash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206', schema_version: 4, tip: { height: 104, hash: 'c'.repeat(64) } }, category, txid: row.txid, address: 'bchreg:synthetic-validation-only', prevout: { resolvable: true, expected_output: { output_index: 0, value_satoshis: '100000000', locking_bytecode: '76a9' } },
    activity: { coverage: { start_height: 0, token_state_status: 'complete_at_indexed_tip', gross_fungible_details_start: 0 }, expected_rows: [row, { ...row, txid: 'd'.repeat(64), fungible_delta: '-9007199254740993', fungible_issued: '0', fungible_burned: '9007199254740993' }] }, acceptance_complete: true, snapshot409: 'NOT_EXECUTED: no owner snapshot mutation' };
}
test('MCP existing-archive exact fields and lossless integer strings survive pure validation', () => {
  const parsed = boundedHandoff.parse(synthetic()); assert.equal(parsed.activity.expected_rows[1].fungible_burned, '9007199254740993'); assert.equal(parsed.prevout.expected_output.output_index, 0);
});
test('no failed gate, foreign URL, wrong network or overlease admission', () => {
  for (const change of [{ resource_gate: { passed: false, normal_pressure: false } }, { rest_url: 'http://user:secret@example.invalid' }, { network: 'chipnet' }, { expires_at: '2026-11-15T00:21:00.000Z' }]) assert.equal(boundedHandoff.safeParse({ ...synthetic(), ...change }).success, false);
});
test('row bounds and independent required issuance/input-only large burn facts', () => {
  const value = synthetic();
  for (const expected_rows of [[], Array(51).fill(value.activity.expected_rows[0]), [value.activity.expected_rows[0]], [value.activity.expected_rows[1]]]) assert.equal(boundedHandoff.safeParse({ ...value, activity: { ...value.activity, expected_rows } }).success, false);
});
test('resolved prevout contract and no manufactured snapshot claim', () => {
  assert.equal(boundedHandoff.safeParse({ ...synthetic(), prevout: { resolvable: false } }).success, false);
  assert.equal(boundedHandoff.safeParse({ ...synthetic(), snapshot409: 'passed with invented hash' }).success, false);
});
