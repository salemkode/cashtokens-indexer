import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyArchiveReadiness } from '../src/archive-readiness.js';
import { IndexerError } from '../src/model.js';

test('archive readiness distinguishes chain sync from missing, catching-up, lagging or stale-fork txindex', async () => {
  const tip = { height: 332433, hash: '1'.repeat(64) };
  const state = { chain: { blocks: tip.height, bestblockhash: tip.hash, pruned: false, initialblockdownload: false },
    indexes: {} };
  const rpc = { async call(method: string, params: unknown[] = []) {
    if (method === 'getblockchaininfo') return state.chain;
    assert.equal(method, 'getindexinfo');
    assert.deepEqual(params, ['txindex']);
    return state.indexes;
  } };
  await assert.rejects(verifyArchiveReadiness(rpc, tip), /absent or still synchronizing/);
  state.indexes = { txindex: { synced: false, best_block_height: tip.height } };
  await assert.rejects(verifyArchiveReadiness(rpc, tip), /absent or still synchronizing/);
  state.indexes = { txindex: { synced: true, best_block_height: tip.height - 1 } };
  await assert.rejects(verifyArchiveReadiness(rpc, tip), /does not match/);
  state.indexes = { txindex: { synced: true, best_block_height: tip.height } };
  state.chain.bestblockhash = '2'.repeat(64);
  await assert.rejects(verifyArchiveReadiness(rpc, tip), /does not match/);
  state.chain.bestblockhash = tip.hash;
  state.chain.pruned = true;
  await assert.rejects(verifyArchiveReadiness(rpc, tip), /unpruned/);
  state.chain.pruned = false;
  state.chain.initialblockdownload = true;
  await assert.rejects(verifyArchiveReadiness(rpc, tip), /initial block download/);
  state.chain.initialblockdownload = false;
  const ready = await verifyArchiveReadiness(rpc, tip);
  assert.deepEqual(ready.txindex, { synced: true, best_block_height: tip.height });
  assert.deepEqual(ready.measured_tip, tip);
  await assert.rejects(verifyArchiveReadiness({ async call() { throw new IndexerError({ message: 'Unavailable read capability' }); } }, tip), /Unavailable read capability/);
});
