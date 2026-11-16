// Pure handoff boundary; does not probe, provision, fetch or start a process.
import { z } from 'zod';
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const quantity = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const boundedHandoff = z.object({
  status: z.literal('verified'), network: z.literal('regtest'), measured_at: z.string().datetime(), expires_at: z.string().datetime(),
  rest_url: z.string().url().refine(value => { const url = new URL(value); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && !url.search && !url.hash; }),
  profile: z.object({ isolated: z.literal(true), peers: z.literal(0) }),
  resource_gate: z.object({ passed: z.literal(true), normal_pressure: z.literal(true) }),
  ready: z.object({ genesis_hash: hash, schema_version: z.literal(4), tip: z.object({ height: z.number().int().nonnegative(), hash }) }),
  category: hash, txid: hash, address: z.string().startsWith('bchreg:'),
  prevout: z.object({ resolvable: z.literal(true), expected_output: z.object({ output_index: z.number().int().nonnegative(), value_satoshis: quantity, locking_bytecode: z.string().regex(/^(?:[0-9a-f]{2})+$/) }) }),
  activity: z.object({ coverage: z.object({ start_height: z.number().int().nonnegative(), token_state_status: z.enum(['complete_at_indexed_tip', 'incomplete']), gross_fungible_details_start: z.number().int().nonnegative() }),
    expected_rows: z.array(z.object({ txid: hash, category: hash, fungible_delta: z.string().regex(/^-?(0|[1-9][0-9]*)$/), fungible_issued: quantity.nullable(), fungible_burned: quantity.nullable(), category_history_complete: z.boolean(), gross_fungible_details_complete: z.boolean() })).min(1).max(50) }),
  acceptance_complete: z.literal(true), snapshot409: z.literal('NOT_EXECUTED: no owner snapshot mutation'),
}).superRefine((value, context) => {
  const duration = Date.parse(value.expires_at) - Date.parse(value.measured_at);
  if (duration < 120000 || duration > 1200000) context.addIssue({ code: 'custom', message: 'Finite measured lease must leave2..20 minutes' });
  if (!value.activity.expected_rows.some(row => row.fungible_issued !== null && BigInt(row.fungible_issued) > 0n)) context.addIssue({ code: 'custom', message: 'Measured chain issuance required' });
  if (!value.activity.expected_rows.some(row => row.fungible_issued === '0' && row.fungible_burned !== null && BigInt(row.fungible_burned) > 9007199254740992n && BigInt(row.fungible_delta) === -BigInt(row.fungible_burned))) context.addIssue({ code: 'custom', message: 'Measured input-only burn above2^53 required' });
});

// Producer proof boundary: caller booleans cannot stand in for native observations.
export function measuredIsolation(input) {
  const facts = z.object({ chain: z.literal('regtest'), genesis: z.literal('0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'), argv: z.array(z.string()).min(1).max(128), connection_count: z.literal(0), peer_info: z.array(z.unknown()).max(0) }).strict().parse(input);
  for (const flag of ['-regtest', '-connect=0', '-dnsseed=0', '-listen=0', '-discover=0', '-upnp=0', '-natpmp=0', '-maxconnections=0']) {
    if (!facts.argv.includes(flag)) throw new Error('Owned no-peer argv proof missing');
  }
  const options = facts.argv.filter(value => value.startsWith('-')).map(value => value.split('=')[0]);
  if (new Set(options).size !== options.length || facts.argv.some(value => /^-(?:chipnet|testnet|chain)(?:=|$)/.test(value))) throw new Error('Conflicting native network proof');
  return { isolated: true, peers: 0 };
}
