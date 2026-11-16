// Pinned-source fixture policy, not a replacement consensus validator or a live-node claim.
import { z } from 'zod';
export const previewCommit = '3e6827e95c7a17497e09ac15556debd116dea1d0';
export const regtest2027ActivationMtp = 1810382400;
export const coinbaseMaturityTicks = 60000;
export class PreviewProfileError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const stateSchema = z.object({ chain: z.literal('regtest'), blocks: z.number().int().nonnegative(), blocks_ticks: z.number().int().nonnegative(),
  mediantime: z.number().int().nonnegative(), target_time: z.literal(600), next_target_time: z.literal(600),
  upgrade_status: z.object({ mempool_activated: z.literal(false), mempool_activation_mtp: z.literal(regtest2027ActivationMtp), software_expiration_time: z.literal(1842004800) }),
});
export function preRuleState(input, horizonEpoch) {
  if (!Number.isSafeInteger(horizonEpoch) || horizonEpoch >= regtest2027ActivationMtp) throw new PreviewProfileError('POST_OR_CROSSING_2027_EPOCH_UNSUPPORTED_WITHIN_104_BLOCK_CAP');
  const state = stateSchema.safeParse(input);
  if (!state.success || state.data.mediantime >= regtest2027ActivationMtp || state.data.blocks_ticks !== state.data.blocks * 600) throw new PreviewProfileError('UNKNOWN_OR_NONLEGACY_NATIVE_TICK_ACTIVATION_PROFILE');
  return state.data;
}
export function fundingPlan({ commit, version, chain, nowEpoch, leaseEndsEpoch }) {
  if (commit !== previewCommit || version !== 29020100) throw new PreviewProfileError('UNSUPPORTED_SOURCE_OR_BINARY_VERSION');
  if (!Number.isSafeInteger(nowEpoch) || !Number.isSafeInteger(leaseEndsEpoch) || leaseEndsEpoch <= nowEpoch || leaseEndsEpoch - nowEpoch > 1200) throw new PreviewProfileError('INVALID_FIXTURE_LEASE_HORIZON');
  const state = preRuleState(chain, leaseEndsEpoch);
  if (state.blocks !== 0 || state.blocks_ticks !== 0) throw new PreviewProfileError('FRESH_GENESIS_ONLY_NO_EXISTING_CHAIN_FUNDING');
  const fundingBlocks = Math.ceil(coinbaseMaturityTicks / 600) + 1;
  return { source_commit: commit, maturity_ticks: coinbaseMaturityTicks, ticks_per_block: 600, funding_blocks: fundingBlocks, total_generated_block_cap: fundingBlocks + 3, expected_final_height: fundingBlocks + 3 };
}
export function boundedMineCount(generated, requested, plan) {
  if (!Number.isSafeInteger(generated) || !Number.isSafeInteger(requested) || generated < 0 || requested < 1 || plan?.source_commit !== previewCommit || plan.total_generated_block_cap !== 104 || generated + requested > plan.total_generated_block_cap) throw new PreviewProfileError('FIXTURE_MINING_CAP_EXCEEDED_OR_UNKNOWN_PROFILE');
  return generated + requested;
}
export function nativeFundingMaturity(chain, horizonEpoch) {
  const state = preRuleState(chain, horizonEpoch);
  // Fresh-chain block1 is at tick600; mempool checks the prospective next block's ticks.
  if (state.blocks !== 101 || state.blocks_ticks + state.next_target_time - 600 < coinbaseMaturityTicks) throw new PreviewProfileError('NATIVE_COINBASE_TICK_DEPTH_NOT_MATURE');
  return state;
}
