import { chipnetCheckpoint, chipnetGenesis } from './network.js';
import { z } from 'zod';
import { hash, IndexerError, rpcBlock } from './model.js';
import type { BitcoinRpc } from './rpc.js';
import type { TokenStore } from './store.js';

const blockchainInfo = z.object({
  chain: z.string(),
  blocks: z.number().int().nonnegative(),
  pruned: z.boolean(),
  initialblockdownload: z.boolean().optional(),
  pruneheight: z.number().int().nonnegative().optional(),
});
const syncOptions = z.object({
  maxBlocks: z.number().int().min(1).max(10000).default(100),
  expectedGenesisHash: hash.optional(),
});
const nodeChains = { mainnet: 'main', chipnet: 'chip', regtest: 'regtest' };
// BCHN chainparams.cpp: first CashTokens activation block. Genesis is shared with BTC.
const cashTokensCheckpoint = { height: 792773, hash: '000000000000000002fc0cdadaef1857bbd2936d37ea94f80ba3db4a5e8353e8' };

/** One bounded sync pass. Only the polling loop may call this; do not run passes concurrently. */
export async function syncOnce(
  store: TokenStore,
  rpc: Pick<BitcoinRpc, 'call'>,
  input: z.input<typeof syncOptions> = {},
  beforeApply?: () => void,
) {
  const options = syncOptions.parse(input);
  const info = blockchainInfo.parse(await rpc.call('getblockchaininfo'));
  const expectedChain = nodeChains[store.network];
  if (info.chain !== expectedChain) {
    throw new IndexerError({ message: `Expected BCHN chain ${expectedChain}, received ${info.chain}` });
  }
  if (store.network === 'chipnet') {
    if (info.blocks < chipnetCheckpoint.height) throw new IndexerError({ message: 'Chipnet source has not reached its post-fork checkpoint' });
    const checkpoint = hash.parse(await rpc.call('getblockhash', [chipnetCheckpoint.height]));
    if (checkpoint !== chipnetCheckpoint.hash) throw new IndexerError({ message: 'Chipnet post-fork checkpoint differs; chain labels/genesis are insufficient' });
    store.setMeta('chain_checkpoint', JSON.stringify(chipnetCheckpoint));
  }
  if (store.network === 'mainnet' && info.blocks >= cashTokensCheckpoint.height) {
    const checkpoint = hash.parse(await rpc.call('getblockhash', [cashTokensCheckpoint.height]));
    if (checkpoint !== cashTokensCheckpoint.hash) {
      throw new IndexerError({ message: 'RPC is not on Bitcoin Cash mainnet: CashTokens activation checkpoint differs' });
    }
  }
  const genesis = hash.parse(await rpc.call('getblockhash', [0]));
  if (store.network === 'chipnet' && genesis !== chipnetGenesis) throw new IndexerError({ message: 'Chipnet genesis hash differs from BCHN chain parameters' });
  if (options.expectedGenesisHash !== undefined && genesis !== options.expectedGenesisHash) {
    throw new IndexerError({ message: 'RPC genesis does not match EXPECTED_GENESIS_HASH' });
  }
  const persistedGenesis = store.getMeta('genesis_hash');
  if (persistedGenesis !== null && persistedGenesis !== genesis) {
    throw new IndexerError({ message: 'RPC genesis differs from this database; use the original node or a new database' });
  }
  if (persistedGenesis === null) store.setMeta('genesis_hash', genesis);

  const anchor = store.anchor();
  if (anchor !== null) {
    if (anchor.height > info.blocks) {
      throw new IndexerError({ message: 'Node is behind the saved scan anchor; wait for it to sync before continuing' });
    }
    const canonicalAnchor = hash.parse(await rpc.call('getblockhash', [anchor.height]));
    if (canonicalAnchor !== anchor.hash) {
      throw new IndexerError({ message: 'Chain reorganized before START_HEIGHT; rescan into a new database' });
    }
  } else if (store.startHeight > 0) {
    if (store.startHeight - 1 > info.blocks) {
      throw new IndexerError({ message: 'Node has not reached START_HEIGHT' });
    }
    store.setAnchor(store.startHeight - 1, hash.parse(await rpc.call('getblockhash', [store.startHeight - 1])));
  }

  const counts = { indexed: 0, rolledBack: 0 };
  while (counts.rolledBack < options.maxBlocks && store.tip() !== null) {
    const tip = store.tip();
    if (tip === null) break;
    const canonical = tip.height <= info.blocks
      ? hash.parse(await rpc.call('getblockhash', [tip.height]))
      : null;
    if (canonical === tip.hash) break;
    store.rollbackTip();
    counts.rolledBack += 1;
  }

  // A large reorganization is reconciled across bounded passes before appending blocks.
  if (counts.rolledBack === options.maxBlocks) {
    return { ...counts, tip: store.tip(), sourceHeight: info.blocks, nodeReady: info.initialblockdownload === false };
  }

  while (counts.indexed < options.maxBlocks) {
    const previousTip = store.tip();
    const height = previousTip === null ? store.startHeight : previousTip.height + 1;
    if (height > info.blocks) break;
    if (info.pruned && info.pruneheight !== undefined && height < info.pruneheight) {
      throw new IndexerError({ message: 'Required block history is pruned; use a node retaining all blocks from START_HEIGHT' });
    }
    const canonicalHash = hash.parse(await rpc.call('getblockhash', [height]));
    const block = rpcBlock.parse(await rpc.call('getblock', [canonicalHash, 2]));
    if (block.hash !== canonicalHash || block.height !== height) {
      throw new IndexerError({ message: 'RPC returned a different block than requested' });
    }
    const expectedParent = previousTip === null ? store.anchor()?.hash : previousTip.hash;
    if (height !== 0 && block.previousblockhash !== expectedParent) {
      throw new IndexerError({ message: 'Chain changed while synchronizing; the next sync pass will reconcile it' });
    }
    const stillCanonical = hash.parse(await rpc.call('getblockhash', [height]));
    if (stillCanonical !== block.hash) {
      throw new IndexerError({ message: 'Chain changed while downloading a block; the next sync pass will reconcile it' });
    }
    beforeApply?.();
    store.applyBlock(block);
    counts.indexed += 1;
  }
  return { ...counts, tip: store.tip(), sourceHeight: info.blocks, nodeReady: info.initialblockdownload === false };
}
