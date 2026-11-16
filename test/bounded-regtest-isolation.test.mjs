// Pure synthetic native-observation fixtures. Never measured handoffs or network calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { measuredIsolation, boundedHandoff } from '../scripts/bounded-regtest-contract.mjs';
function facts() { return { chain: 'regtest', genesis: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206', argv: ['owned-bitcoind', '-regtest', '-connect=0', '-dnsseed=0', '-listen=0', '-discover=0', '-upnp=0', '-natpmp=0', '-maxconnections=0'], connection_count: 0, peer_info: [] }; }
test('profile produced only from complete native/argv facts', () => assert.deepEqual(measuredIsolation(facts()), { isolated: true, peers: 0 }));
test('nonzero, missing and false native facts refused', () => {
  for (const change of [{ connection_count: 1 }, { connection_count: false }, { connection_count: undefined }, { peer_info: [{}] }, { peer_info: undefined }, { chain: 'chip' }, { genesis: 'a'.repeat(64) }, { isolated: true }]) assert.throws(() => measuredIsolation({ ...facts(), ...change }));
});
test('missing/conflicting owned network arguments refused', () => {
  assert.throws(() => measuredIsolation({ ...facts(), argv: facts().argv.filter(value => value !== '-connect=0') }));
  assert.throws(() => measuredIsolation({ ...facts(), argv: [...facts().argv, '-connect=peer.invalid'] }));
});
test('consumer boundary rejects missing/false/nonzero profile', () => {
  const schema = boundedHandoff.innerType ? boundedHandoff.innerType().shape.profile : boundedHandoff.shape.profile;
  for (const profile of [undefined, { isolated: false, peers: 0 }, { isolated: true, peers: 1 }]) assert.equal(schema.safeParse(profile).success, false);
});
