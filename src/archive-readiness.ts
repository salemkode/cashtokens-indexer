import { z } from 'zod';
import { hash, IndexerError } from './model.js';
import { BitcoinRpc } from './rpc.js';

const snapshot = z.object({ height: z.number().int().nonnegative(), hash });

/** Shared historical consumers require an unpruned source AND a caught-up txindex.
 * Extraction readiness alone deliberately makes neither promise. */
export async function verifyArchiveReadiness(rpc: Pick<BitcoinRpc, 'call'>, expected: z.infer<typeof snapshot>) {
  const tip = snapshot.parse(expected);
  const chain = z.object({ blocks: z.number().int().nonnegative(), bestblockhash: hash,
    pruned: z.literal(false), initialblockdownload: z.literal(false) }).safeParse(await rpc.call('getblockchaininfo'));
  if (!chain.success) throw new IndexerError({ message: 'Historical BCH source must be unpruned and out of initial block download' });
  const index = z.object({ txindex: z.object({ synced: z.literal(true), best_block_height: z.number().int().nonnegative() }) })
    .safeParse(await rpc.call('getindexinfo', ['txindex']));
  if (!index.success) throw new IndexerError({ message: 'Historical BCH txindex is absent or still synchronizing' });
  if (chain.data.blocks !== tip.height || chain.data.bestblockhash !== tip.hash || index.data.txindex.best_block_height !== tip.height) {
    throw new IndexerError({ message: 'Historical BCH source or txindex does not match the measured canonical tip; remeasure after catch-up' });
  }
  return { pruned: false, initial_block_download: false, txindex: index.data.txindex,
    measured_tip: tip, verified_at: new Date().toISOString() };
}
