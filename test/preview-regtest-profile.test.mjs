// Pure mocked native facts. No worker/node/mining or current-header observation is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fundingPlan, preRuleState, boundedMineCount, nativeFundingMaturity, previewCommit, regtest2027ActivationMtp } from '../scripts/preview-regtest-profile.mjs';
const nowEpoch = 1794772246;
function native(blocks = 0) { return { chain: 'regtest', blocks, blocks_ticks: blocks * 600, mediantime: nowEpoch, target_time: 600, next_target_time: 600, upgrade_status: { mempool_activated: false, mempool_activation_mtp: regtest2027ActivationMtp, software_expiration_time: 1842004800 } }; }
function plan() { return fundingPlan({ commit: previewCommit, version: 29020100, chain: native(), nowEpoch, leaseEndsEpoch: nowEpoch + 600 }); }
test('exact preview default pre2027 regtest requires60000ticks;101-block cushion remains bounded', () => {
  const value = plan(); assert.equal(value.maturity_ticks, 60000); assert.equal(value.funding_blocks, 101); assert.equal(value.expected_final_height, 104);
  assert.equal(nativeFundingMaturity(native(101), nowEpoch + 600).blocks, 101);
  assert.throws(() => nativeFundingMaturity(native(99), nowEpoch + 600));
});
test('post2027 requires1000one-minute intervals and is refused rather than mine beyond fixture cap', () => {
  assert.equal(60000 / 60, 1000);
  assert.throws(() => fundingPlan({ commit: previewCommit, version: 29020100, chain: native(), nowEpoch: regtest2027ActivationMtp, leaseEndsEpoch: regtest2027ActivationMtp + 600 }), /POST_OR_CROSSING/);
  assert.throws(() => preRuleState({ ...native(), target_time: 60, next_target_time: 60 }, nowEpoch + 600), /UNKNOWN_OR_NONLEGACY/);
});
test('same current MTP does not make Chipnet activation default a regtest profile', () => {
  const chipDefault = native(); chipDefault.upgrade_status.mempool_activation_mtp = 1794744000;
  assert.throws(() => preRuleState(chipDefault, nowEpoch + 600), /UNKNOWN_OR_NONLEGACY/);
  assert.ok(nowEpoch >= 1794744000 && nowEpoch < regtest2027ActivationMtp);
});
test('crossing activation during finite lease is unsupported before any generation', () => {
  assert.throws(() => fundingPlan({ commit: previewCommit, version: 29020100, chain: native(), nowEpoch: regtest2027ActivationMtp - 300, leaseEndsEpoch: regtest2027ActivationMtp + 1 }), /POST_OR_CROSSING/);
});
test('unknown source/version, altered expiry, inconsistent ticks and reused-chain profile refuse', () => {
  for (const change of [{ commit: 'unknown' }, { version: 29020000 }, { chain: native(1) }, { chain: { ...native(), blocks_ticks: 1 } }]) assert.throws(() => fundingPlan({ commit: previewCommit, version: 29020100, chain: native(), nowEpoch, leaseEndsEpoch: nowEpoch + 600, ...change }));
  const state = native(); state.upgrade_status.software_expiration_time = 0; assert.throws(() => preRuleState(state, nowEpoch + 600));
});
test('no dynamic extra mining, noninteger/negative increments or unknown cap', () => {
  const value = plan(); assert.equal(boundedMineCount(101, 3, value), 104);
  for (const count of [4, 1000, 0, -1, 1.5]) assert.throws(() => boundedMineCount(101, count, value));
  assert.throws(() => boundedMineCount(0, 101, { ...value, total_generated_block_cap: 1004 }));
});
