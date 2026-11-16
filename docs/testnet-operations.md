# Blaze Indexer — functional testnet operations

`testnetFunctionalReady=false`; `publicReleaseReady=false` until actual required
journeys are evidenced. Current connection authority: `docs/chipnet-connection.json`.
There is no verified live Chipnet endpoint yet. No full-chain download, paid RPC
purchase, chain relocation or mainnet transaction is performed by these commands.

## Chipnet identity and prerequisites

The shared target requires a retained, **unpruned, synchronized BCHN Chipnet**
source and a ready historical `txindex`. Verify `getblockchaininfo` reports
`initialblockdownload=false` and `pruned=false`, then `getindexinfo("txindex")`
reports a `txindex` object with `synced=true` and `best_block_height` equal to the
measured canonical tip. Chain synchronization alone does not establish index
readiness. Resolve representative historical transactions and BCH prevouts as a
separate evidence step. An Electrum checkpoint cannot provide these BCHN methods.
A known block location can serve individual reads without txindex, but does not
satisfy the shared arbitrary-history consumer contract.

Pinned BCHN v29.2.0 chain parameters:

- Genesis: `000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b`.
- Post-split block115252: `00000000040ba9641ba98a37b2e5ceead38e4e2930ac8f145c8094f94c708727`.
- First CashTokens block121957. A later scan declares incomplete global state.

Source: https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/v29.2.0/src/chainparams.cpp.
Both genesis and post-fork hash are enforced, independently of `bchtest`/`chain`
labels. Mainnet/testnet3/testnet4/regtest are never substituted for Chipnet.

Upstream credentials stay in a private ignored service environment file or cookie
file. User-only credentials must use T3 secure file delivery, never chat/browser
configuration. Preserve the original read role: write privileges require separate
`BCH_TEST_RPC_*` configuration and exact local approvals. There is no implicit
inheritance from read credentials. The prior secure URL request timed out without
an answer; do not issue parallel/duplicate cards from other threads.

Before an ingestion run, inspect existing processes, database writer ownership,
assigned ports and free storage. Defaults pause before commit below512 MiB free.
Do not point at an existing user wallet/data directory or start a new P2P sync.
Configure a bounded representative start deliberately; complete historical token
state requires an activation/genesis scan against an already retained source.
A newly created category can have a complete own history inside a later partial
scan; all responses retain the global coverage boundary.

## Run and verify (after secure upstream configuration)

```sh
npm run typecheck
npm run build
# Configure private .env: NETWORK=chipnet, BCH_RPC_URL/credentials, DATABASE_PATH,
# START_HEIGHT and assigned PORT. .env.example contains placeholders, not a node.
npm start
```

`/healthz` is liveness. `/readyz` must be200: node IBD false, no sync error, a recent
successful pass, and committed/source heights equal. It becomes503 on catch-up,
IBD, error, stale RPC or shutdown. This is **extraction readiness**, not proof of
unpruned history or txindex catch-up; those are independently measured by the
shared-source acceptance harness and recorded under `rpc.archive_readiness`. Shutdown cancels active RPC requests; it does
not wait out a stalled60-second request. `MIN_FREE_BYTES`, `MAX_SYNC_AGE_MS` and
`RPC_MAX_RESPONSE_BYTES` are explicit operating limits. Per upstream client,
concurrency is8 and queued calls64; oversized replies fail without accepting data.

```sh
npm run accept:chipnet -- --rest-url http://127.0.0.1:3001 --category <real-category> --txid <real-txid> --publish-connection
```

This **read-only** harness verifies actual node genesis/fork hash, readiness and
canonical tip, unpruned history and txindex readiness, a category with observed genesis, all its UTXOs (maximum500), exact
supply/NFT counts, scripts/commitments, native BCH inputs and advertised REST
queries. It compares `gettxout(..., false)` and detects a moving tip. If
`BCH_HISTORY_RPC_*` is configured, its credentials remain separate and its genesis,
fork, canonical tip and txindex readiness must independently pass. Optional
`RPC_PROXY_URL` is verified with the same index-readiness gate before being
published. Without that measured URL, `supported_read_methods` stays empty in the
connection report; verified upstream capabilities are recorded separately. An optional
`--registry-file` verifies exact committed bytes through the content endpoint.
The source must report at least one peer and a canonical header time no older
than `MAX_CHIPNET_TIP_AGE_SECONDS` (default7,200, configurable60..86,400); a timestamp
more than7,200 seconds in the future also fails. The report records the measured
tip timestamp/age/peer count and the actual policy. It starts no node, signs nothing and broadcasts nothing. It refuses another
network rather than relabeling it. Only a successful measurement may update the
owner connection record; that alone is not complete project/browser acceptance.

## Separate RPC composition for consumers

- REST data: assigned indexer URL, e.g. `http://127.0.0.1:3001`.
- Optional **read-only** loopback JSON-RPC: `RPC_PROXY_PORT=3002` (0 asks the OS
  for a free port; the returned assigned port must be retained). Allowed methods:
  `getblockchaininfo`, `getblockhash`, `getblockheader`, `getblock`, `getblockstats`,
  `getrawtransaction`, `gettxout`, `getrawmempool`, `getmempoolinfo`, `getnetworkinfo`,
  `getindexinfo`. The last method is read-only; it does not grant reindex/admin
  privileges.
  It verifies chain identity, exposes no upstream credentials, and rejects browser
  Origin requests and every wallet/admin/write method. It uses the configured
  archive/history source when supplied; otherwise the extraction source.
- Optional **test-submit** loopback JSON-RPC: `TEST_RPC_PORT=3003`, separate
  `BCH_TEST_RPC_URL`/credentials and `TEST_APPROVAL_FILE`. Only
  `testmempoolaccept` and `sendrawtransaction` exist. No `getblockhash` or wallet
  method is granted here. Mainnet configuration is rejected.

A server-side consumer composes these two URLs: verification reads such as
`getblockhash(0)` and `getblockhash(115252)` go to the read proxy; approved signed
bytes go to the test-submit URL with a private capability header. **Do not elevate
read credentials** or put upstream/capability secrets in browser code. Focus's
owned localAndroid debug bridge on loopback3487 can forward these server-side
calls through its existing service; Focus owns its adb reverse/device claim.
No public HTTPS deployment or indexer takeover of that device/port is required.
CashCart's server can use the same composition after actual source verification.
No live URL/port is advertised until measured in the owner contract.

### Approval file and fee/journal rules

The trusted wallet/owner approval service writes an atomic mode0600 file owned
by the indexer service user **after explicit transaction review**. Structure:

```json
{
  "network": "chipnet",
  "genesis_hash": "000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b",
  "dedicated_test_identity": true,
  "max_fee_satoshis": "10000",
  "capability": "<private random32-byte lowercase hex; never display or commit>",
  "allowed_outpoints": [{ "txid": "<dedicated test coin txid>", "vout": 0 }],
  "transactions": [{ "txid": "<locally derived exact txid>", "hex": "<exact reviewed signed bytes>", "expires_at": "<ISO time within one hour>" }]
}
```

This is a template, not a working approval or a real secret. There are no private
keys/seeds. Never set the dedicated-identity flag for pre-existing user wallets.
Policy limits: maximum100 approved input outpoints/transactions, raw signed bytes
at most one MiB, expiry at most one hour, fee cap at most1,000,000 satoshis (the
reviewed per-policy cap should normally be much lower). The service recomputes
txid and fee from decoded outputs and native current input values; all inputs
must be individually approved. `allowhighfees` overrides are never accepted.

`testmempoolaccept` params are `[[signedHex]]`; `sendrawtransaction` params are
`[signedHex]`. A private `Authorization: Bearer <capability>` is required. Browser
Origins are rejected. The signed bytes themselves bind recipients and amounts;
there is no generic signing/funding/wallet RPC or arbitrary recipient API.

Before the first send, exact bytes/txid/fee are committed to a separate FULL-sync
SQLite journal at `<DATABASE_PATH>.test-submissions.sqlite`. A timeout/lost response
becomes unresolved; repeat calls reconcile via native `getrawtransaction` and
**never automatically broadcast again**. Journal survives restart. A new fee or
transaction requires new signed bytes/txid and approval, not deletion of pending
records. Accepted submission is not confirmation or proof of fulfillment.
Stop the owning service before backing up/restoring the separate journal and
policy consistently; do not discard unresolved journal entries to make a test green.

## Activity, metadata and arbitrary identities

Global activity contract: `docs/activity-api-v1.md`. Mixed categories, complete
burns and gross fungible quantities are retained independently of spent-output
pruning. Unknown old/partial gross fields remain null, not0.

Metadata/category authchains: `docs/authchain-api-v1.md`. Shared publication-root
identities and `AUTHCHAIN_BASES` are indexed without copying a whole BCH graph.
For an arbitrary confirmed historical unpublished root:

```http
POST /v1/authchains/<authbase>/resolve
Content-Type: application/json

{"max_blocks":10}
```

Each request scans at most100 retained native blocks (default10);202 reports a
resumable cursor,200 means the requested identity path is complete. Root/current
UTXO checks can terminate safely before scanning further. There are at most two
active jobs,64 cached roots,10,000 identity steps and one MiB per cached path.
Only requested identity facts are retained, not full blocks. A complete path is
watched during later indexing and invalidated on reorg. An index advancing during
final native validation cannot publish stale complete data. Old/pruned/txindex
unavailability remains explicit. No arbitrary browser/full-chain scan is required.
The normal authchain route then serves the result with
`coverage.method=targeted_native_scan`; complete targeted coverage can coexist
with incomplete global scan coverage. Discovery still does not certify issuer
honesty, Nostr identity, signatures, or current authority outside that snapshot.

`POST /v1/authchains/<base>/metadata/verify` accepts `{content_base64}` up to one MiB
of exact registry bytes. SHA256 is matched to the current indexed publication and
the bundled upstream BCMR schema is checked. The16 MiB/128-entry byte cache is by
content hash. The service never blindly fetches untrusted URIs. `verified_content`
is deliberately separate from `issuer_authority_verified`, which remains false.
Clients fetch published HTTPS/IPFS content under their own safe transport policy.

## Backup, migration and fault recovery

```sh
npm run build
npm run db:backup -- --database /owned/index.sqlite --destination /owned/backups/snapshot.sqlite
npm run db:check -- --database /owned/backups/snapshot.sqlite
npm run db:restore -- --database /owned/backups/snapshot.sqlite --destination /owned/new/index.sqlite
# Only after the old process is established dead:
npm run db:unlock -- --database /owned/index.sqlite
```

Backup uses SQLite's online API and includes committed WAL data. Destinations
must not exist; restore never overwrites an old database. Checks include integrity,
FKs, required tables and network/schema metadata. Preserve network, scan boundary
and `AUTHCHAIN_BASES` when restarting a restored database. Migration/gross detail
coverage are explicit; no old pruned payload is guessed back into existence.
Writer locks reject concurrent services; live/PID-reused/uncertain owners cannot
be silently cleared. A deep reorg past `undo_floor` requires restoring a suitable
checkpoint or rescanning a **separate** database and switching after verification.

Tests cover SIGKILL during uncommitted output insertion, restart after committed
WAL writes, SQLite disk-full rollback, storage guard, online backup and restore,
atomic failed migration, reorg/undo floor and unresolved test-submit state.
This is not a power-loss certification for every filesystem or host.

## Supporting evidence and artifacts

- `test/regtest.test.ts`: real native BCHN29.2.0, new no-peer regtest temp wallet,
  actual >2^53 CashTokens and all NFT capabilities, genesis/reserve/content checks,
  pending txs, read proxy, approved test-submit gateway, global burns, arbitrary
  authbase resolution, reorg and backup restore. It is **not Chipnet**.
- `test/main.test.ts`: seven lifecycle/fault profiles, also run on the clean
  production-only compiled artifact.
- `scripts/retention-check.ts`: bounded synthetic disk-backed2,000-block churn,
 32-block undo,33 retained output rows/2,000 historical movements and exact rollback.
  Metrics are development observations, not chain capacity/VPS sizing.
- `npm run check:clean`: isolated Node24 `npm ci`, compile, prune dev dependencies,
  compiled lifecycle/contract/gateway tests, local versioned tgz+SHA256. Source
  checkout uses `Dockerfile`; compiled tgz ships its own runtime Dockerfile.
- Compose config validates with a temporary placeholder env. Docker engine is
  unavailable at the configured OrbStack socket; no Docker build/runtime success
  is claimed. No daemon, deployment or foreign process is started as a workaround.
- MCP reported a clean Node24.0.0 installed-consumer8-tool/2-resource/cancellation
  pass on the leased actual-regtest target. Its final snapshot completed, and the
  owned lease/node/indexer were stopped. No consumer should use that stopped URL.
