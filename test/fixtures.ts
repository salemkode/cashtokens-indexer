import { rpcBlock, rpcTransaction } from '../src/model.js';
import { z } from 'zod';

export function id(value: number) { return value.toString(16).padStart(64, '0'); }
export const alice = `76a914${'11'.repeat(20)}88ac`;
export const bob = `76a914${'22'.repeat(20)}88ac`;
export function output(category = id(100), amount = '100', script = alice,
  nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string }) {
  return { n: 0, value: 0.000008, scriptPubKey: { hex: script },
    tokenData: { category, amount, ...(nft === undefined ? {} : { nft }) } };
}
export function tx(value: number, outputs: z.input<typeof rpcTransaction>['vout'],
  inputs: z.input<typeof rpcTransaction>['vin'] = [{ coinbase: '00' }]) {
  return { txid: id(value), vin: inputs, vout: outputs.map((item, n) => ({ ...item, n })) };
}
export function block(height: number, transactions: z.input<typeof rpcBlock>['tx'],
  blockId = 1000 + height, previousId = 1000 + height - 1) {
  return { height, hash: id(blockId), ...(height === 0 ? {} : { previousblockhash: id(previousId) }),
    time: 1700000000 + height, tx: transactions };
}
