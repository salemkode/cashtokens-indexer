# Blaze — CashTokens indexer

A Bitcoin Cash backend for [`salemkode/explorer`](https://github.com/salemkode/explorer), using **BCHN + SQLite + a small REST API**. No Chaingraph, Hasura, PostgreSQL, or GraphQL service is required. CashTokens only; legacy SLP indexing is outside this project.

The historical explorer migration is preserved in [integration/explorer.patch](integration/explorer.patch). Its token, block, transaction, and mempool views use this REST API. Address history/balance use a configurable Electrum server. The indexer exposes confirmed BCMR authchain **discovery hints**; independent consumers must verify authority and content. See the [v1 authchain contract](docs/authchain-api-v1.md). It does not implement Nostr identity or certify issuer ownership.

The smaller application stack is intended to reduce hosting overhead. The BCH full node still has its own substantial disk and synchronization requirements. No production cost or speed comparison with Chaingraph has been established. The synthetic microbenchmark is not evidence for mainnet capacity or VPS sizing. See the [storage-first extraction plan](docs/storage-and-extraction-plan.md) before choosing hosting.

## Current Chipnet delivery status

**Server deployment:** macOS is excluded from node hosting. Use the
[Linux server guide](deploy/server/README.md) for separate mainnet/Chipnet
indexers, private configuration and persistent databases. The
[six-core/16 GB daily-session runbook](deploy/server/RUNBOOK.md) covers the
roughly 900 GB target, graceful stop/resume, read-only acceptance and performance/
recovery testing. Local resource-gate
observations below are historical; they are not server prerequisites or live
acceptance. Current status is maintained in [RELEASE-STATUS.md](RELEASE-STATUS.md).

The [single post-cleanup quiet gate](docs/chipnet-after-ox-gate.json) passed disk
admission but failed sustained memory pressure. No restore, mount or node followed;
no automatic repeated probe is allowed. Earlier free-space snapshots below are historical.

The detached stage image is now in [verified cold custody](docs/cold-image-custody.md).
Observed free space9.29 GiB remains below entry gates; restoration and explicit
inode reconciliation are prerequisites before any future resume. No node is active.

The later conditional resume is blocked before mount by a60-second observation:
4.42 GiB free and warning memory pressure. [Resume code/evidence](docs/chipnet-resume-control.json)
retains the original image and cumulative budgets; actual native resume is unverified.

`testnetFunctionalReady=false`; `publicReleaseReady=false`. The owner connection
is [unavailable](docs/chipnet-connection.json). The one bounded native Chipnet
measurement stopped cleanly on host memory-pressure warning at height0; it did
not verify the split checkpoint, synchronized txindex, CashTokens or REST coverage.
No automatic retry/resume is authorized. The [operator supervisor record and
limits](docs/owned-node-supervisor.md) distinguish actual process evidence from
regtest/unit support and historical Node24 artifact checks.

## Run the indexer

Requirements: **Node.js 24+**, an updated **Bitcoin Cash Node (BCHN)** supporting the active consensus rules, and retained block history from your configured start height. CashTokens extraction does **not** require `txindex`. The explorer's unrestricted historical BCH transaction routes need an archival source with **`txindex=1`** and the completed transaction index; this can be a separate node. A pruned extraction node cannot also provide all historical BCH pages.

```sh
npm ci
cp .env.example .env
# Edit .env with your BCHN RPC connection.
npm run dev
```

For a compiled process:

```sh
npm run build
npm start
```

For a token-only service, set `SERVE_BCH_API=false`; it will read retained blocks from `BCH_RPC_URL` and expose only token routes. An existing authenticated remote node avoids storing its blockchain on the service host. Backfill still needs those historical blocks on the source.

To serve BCH explorer pages from another node, set `BCH_HISTORY_RPC_URL` and its independent `BCH_HISTORY_RPC_USER`, `BCH_HISTORY_RPC_PASSWORD`, or `BCH_HISTORY_RPC_COOKIE_FILE`. When unset, the original shared-node behavior remains. History credentials never inherit extraction credentials, and a failed configured history node is not silently replaced. Disabling BCH routes means those explorer pages need a separately supplied API.

Useful **archival historical-data node** configuration:

```ini
server=1
txindex=1
prune=0
# Configure rpcauth, or use the node's cookie file; keep RPC private.
```

`BCH_RPC_COOKIE_FILE` takes precedence over `BCH_RPC_USER` / `BCH_RPC_PASSWORD`; the cookie is reread after node restarts. RPC credentials stay on the backend and must never be included in the explorer's public URLs. The client only permits specific read-only methods.

The default HTTP binding is `127.0.0.1:3001`. Use an HTTPS reverse proxy to expose the read API to your explorer, and configure `CORS_ORIGINS` for its origin. A single process owns each SQLite file; do not run multiple indexers against one database.

## Start height and network

- `NETWORK=mainnet`, `chipnet`, or `regtest`; use a separate process/database for each network.
- `START_HEIGHT=0` is the complete default. For mainnet, **`START_HEIGHT=792773`** safely starts at the first CashTokens activation block and skips pre-token history. [BCHN checkpoint source](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/07576013c91ff4a3a74acd85f189c69121cdad1b/src/chainparams.cpp).
- On other networks, keep `0` unless you have verified the activation boundary. Starting after any token's creation produces incomplete balances/history and incorrect first-observed genesis information.
- The service pins node genesis identity, checks BCHN's network name, and verifies the mainnet CashTokens activation checkpoint when available. BTC and BCH share a genesis block, so genesis alone is insufficient.
- Each nonzero start height has a persisted parent anchor. A reorganization crossing that anchor stops indexing and requires a rescan into a new database.
- Network/start height changes are rejected. Schema 3 migrates transactionally to schema 4 binary identifiers, preserving token history and balances. Schemas 1/2 require a new rescan. Back up with SQLite's online backup first; migration can require temporary disk/WAL space. Schema-3 migration cannot recover prior metadata-only spends and reports authchain coverage `incomplete`. See [storage and recovery](docs/storage-v4.md).

`/healthz` indicates the HTTP process is alive. **Wait for HTTP 200 from `/readyz` before switching explorer traffic**; it returns 503 during catch-up or a synchronization error. `/v1/status` reports the committed token-index tip. Token results include `network`, `confirmed_only`, and `indexed_height` so partial indexing is visible.

## Explorer setup

The explorer project owns its current REST adapter and evidence UI. Coordinate
against the contracts below; do not apply the historical patch over its ongoing
changes. For a clean checkout of the original explorer only, the preserved
migration can be reviewed/applied on a task branch:

```sh
git switch -c feature/lightweight-cashtokens
git apply /absolute/path/to/blaze/integration/explorer.patch
pnpm install
```

Configure its public build variables:

```dotenv
NUXT_PUBLIC_CASHTOKENS_API=https://your-indexer.example
# Optional, a separate chipnet service:
NUXT_PUBLIC_CASHTOKENS_CHIPNET_API=https://your-chipnet-indexer.example
NUXT_PUBLIC_ELECTRUM_MAINNET_URL=wss://bch.imaginary.cash:50004
# Required to display chipnet address history/balance:
NUXT_PUBLIC_ELECTRUM_CHIPNET_URL=wss://your-chipnet-electrum.example
```

These API origins serve both BCH and token routes. Do not include `/v1` in the base URL. Mainnet and chipnet never fall back to one another. Missing/failed providers display an error; the migration does not fall back to Chaingraph. Rebuild the static explorer after changing build variables. Remove its old `CHAINGRAPH_HTTP` / `CHAINGRAPH_WS` variables.

```sh
pnpm lint:type
pnpm generate
```

All explorer changes remain on a task branch. Merging and production deployment are manual user actions.

## API

REST collection routes accept `limit` and `offset`. Token limits are 1–500 (default 100); BCH limits are bounded separately. Ordering is deterministic at a given chain tip. New blocks or reorganizations can move offset-based pages; these are not snapshot cursors.

| Route | Result |
| --- | --- |
| `GET /v1/activity` | Paged global CashTokens transaction activity, exact burns/issuance, fork snapshot and partial coverage; [contract](docs/activity-api-v1.md) |
| `GET /v1/status` | Network, scan boundary, committed tip, anchor |
| `GET /v1/tokens` | Token summaries, including fully burned categories |
| `GET /v1/tokens/:category` | Exact live fungible supply, NFT/minting/UTXO counts, genesis transaction |
| `GET /v1/tokens/:category/genesis` | Category-filtered initial quantities and native genesis outputs |
| `GET /v1/tokens/:category/supply` | Exact current/initial supply and indexed output0 reserve/circulating facts |
| `GET /v1/tokens/:category/holders` | Entire balances grouped by locking bytecode **before** pagination |
| `GET /v1/tokens/:category/transactions` | Confirmed token movements, including complete burns |
| `GET /v1/tokens/:category/authchain` | Confirmed authhead/publication hints, paged revisions and explicit coverage; [schema and semantics](docs/authchain-api-v1.md) |
| `GET /v1/tokens/:category/utxos` | Live token UTXOs; optional `nft=true/false`, `capability=none/mutable/minting` |
| `GET /v1/scripts/:hex/tokens` | Aggregated script holdings, including fungibles attached to NFTs |
| `GET /v1/scripts/:hex/utxos` | Script's live UTXOs; same NFT filters |
| `GET /v1/authchains/:authbase` | Shared non-category publication/configured identity discovery |
| `POST /v1/authchains/:authbase/resolve` | Bounded resumable native resolution for arbitrary historical authbases, including unpublished roots |
| `GET /v1/authchains/:authbase/metadata` | Current publication/content-cache state |
| `POST /v1/authchains/:authbase/metadata/verify` | Exact-byte hash and upstream BCMR schema diagnostics; no issuer trust claim |
| `GET /v1/bch/height` | Cached node height without header reads |
| `GET /v1/bch/tip` | Node's current BCH tip |
| `GET /v1/bch/blocks` | Recent BCH blocks |
| `GET /v1/bch/blocks/:heightOrHash` | Block plus paged transactions |
| `GET /v1/bch/transactions/:txid` | Transaction and resolved input outputs |
| `GET /v1/bch/transactions?ids=...` | Bounded transaction batch |
| `GET /v1/bch/mempool` | Paged unconfirmed BCH transactions |

Category IDs and URL script bytes are ordinary hexadecimal without `0x` or `\x`. Binary fields in output records retain the explorer's `\x` representation. **All quantities are decimal strings**; use BigInt or a decimal library, never JavaScript `Number`, for token arithmetic. A CashTokens category is the genesis input's previous transaction ID, not necessarily the token-creating transaction ID.

NFT capabilities distinguish `none` (immutable), `mutable`, and `minting`. An empty commitment is different from an absent NFT. NFT count includes all capabilities; minting authorities are also counted separately. Commitments up to 128 bytes support the May 2026 upgrade; BCHN enforces activation/consensus validity.

Token history's `fungible_delta` describes the change in live supply in that transaction, not the amount transferred between holders. Token-only history does not compute total BCH input value and returns `input_value_satoshis: null`; the BCH transaction route supplies detailed inputs separately.

## Correctness and operating boundaries

Blocks commit atomically in SQLite WAL mode. Indexed, materialized category totals and holder balances update within the same transaction, so summary reads do not rescan historical UTXOs. All token outputs are inserted before resolving inputs, so **CTOR spenders can precede their parents**. Reorg rollback deletes orphaned transactions and restores their spent outputs within `UNDO_DEPTH` (default 288 blocks). Older spent and unspendable output rows are discarded atomically; a deeper reorg stops with a rescan requirement. Compact transaction/movement history and genesis remain. OP_RETURN and scripts over 10,000 bytes are excluded from live supply/holders. Validation is delegated to the trusted BCHN node; this is not an independent consensus validator.

Token balances/supply are **confirmed-only**. The BCH mempool panel does not imply a token mempool overlay. Unconfirmed token transfers, conflicts, evictions, and pending balance changes are not indexed in this version. Authchain discovery follows confirmed output-0 spends, including metadata-only transactions. Check `coverage.status`, `indexed_height` and fork hash; any nonzero scan or old-schema migration reports `incomplete`. Full authbase publication history requires a fresh scan from height 0. These hints and metadata hash diagnostics do not prove current authority or issuer trust.

For SQLite backups, use its online backup mechanism or stop this process cleanly before copying its database; copying only the main file while WAL writes run is insufficient. Keep a separate database for a rescan and switch over after it is ready.

## Verify and measure

```sh
npm run typecheck
npm test
npm run test:built
npm run storage-report -- --database /path/to/existing/cashtokens.sqlite
```

Tests exercise exact amounts, all NFT capabilities, mixed NFT/fungible outputs, burns, CTOR ordering, atomic failures, rollback, restart, chain identity, RPC privacy/timeouts, REST validation, and startup/shutdown. They use SQLite and deterministic RPC/HTTP fixtures; they are not a live-mainnet acceptance test.

**Internal microbenchmark only; excluded from capacity planning.** A local before/after result is recorded in [docs/benchmark-results.json](docs/benchmark-results.json) and [its chart](docs/benchmark.html). Materialized totals reduced repeated summary/holder reads while adding ingestion work. These are separate development runs, not a production or Chaingraph comparison.

For a compiled or production installation, use `npm run storage-report:built -- --database /path/to/cashtokens.sqlite`. Add `--details` only when an expensive table/page scan is acceptable. Inspection does not checkpoint or compact the database; normal SQLite reader shared-memory locking may still occur.

The benchmark measures synthetic in-memory token ingestion and local Fastify request handling. Set `BENCH_OUTPUTS` and `BENCH_REQUESTS` to vary the workload. It does not measure network latency, full-chain catch-up, storage growth, or compare another indexer. Measure those on your intended hardware before sizing production.

## Docker

```sh
cp .env.example .env
# Configure reachable BCHN RPC. A host node may use host.docker.internal,
# with BCHN bind/allow settings restricted to the container's network.
docker compose up --build -d
```

The container runs as a non-root user and keeps SQLite in a named volume. The API port binds to localhost on the host. Container RPC access/cookie paths must match your deployment; a host-only `127.0.0.1` RPC URL does not refer to the host from inside a container.

Community findings and alternatives: [Chaingraph ecosystem research](docs/chaingraph-ecosystem.md).

## Historical local checkpoint (superseded stopping condition)

The direct implementation pass on 15 November 2026 passed **74 tests**, including
15 named acceptance subtests mapped to the original explorer's referenced query
inventory, plus TypeScript checking and compilation. The final suite passed on
Node 24.18.0; all three compiled-server lifecycle profiles also passed on Node 24. These use bounded SQLite,
RPC and HTTP fixtures. No configured live BCHN or production database was
available for real-chain correctness, storage sizing or performance acceptance.
The current live `indexed_height` is therefore unknown, not a fixture height.

The authchain route is discovery-only. Its [JSON Schema](docs/authchain-api-v1.schema.json)
and [coverage contract](docs/authchain-api-v1.md) are intended for the explorer
adapter and an independent issuer verifier using its own BCHN. `incomplete` is
explicit for migrations and nonzero scan starts. Publication-free historical authbases now have a bounded explicit native-resolution path;
publication roots and configured identities are tracked automatically. Mempool token/authchain
**balance overlays** are separate from the implemented pending BCH transaction/mempool views.
The backend verifies supplied registry bytes and schema, and never blindly fetches untrusted URIs. The legacy `genesis_txid`/`genesis_height` fallback describes
first observation when `genesis_verified` is false; consumers must not present it
as a proven creation transaction. This backend alone does not establish issuer
trust or complete explorer feature parity.


## Functional Chipnet delivery (active)

`testnetFunctionalReady=false`; `publicReleaseReady=false`. The owner-maintained
connection record is [docs/chipnet-connection.json](docs/chipnet-connection.json).
It currently advertises **no verified Chipnet endpoint**. Independent Electrum
checkpoint observations are not a replacement for BCHN method/prevout access.
See [RELEASE-STATUS.md](RELEASE-STATUS.md) for feature vs evidence vs prerequisite.

Chipnet RPC reads and ingestion pin both genesis and official post-fork block115252;
`bchtest` address prefixes alone do not distinguish networks. First Chipnet
CashTokens block is121957. A later scan explicitly reports incomplete global state;
a category created within the scan can have its full own history. Metadata history
has separate coverage and a bounded targeted-resolution path.

Operational and integration instructions: [testnet operations](docs/testnet-operations.md).
New production paths include online backup/restore, writer claims/stale recovery,
IBD/freshness readiness, cancellable RPC/shutdown, free-space guards, bounded native
responses/concurrency, read-only loopback RPC and a **separate disabled-by-default**
exact-approval test submission service. No wallet or signing keys are held here.

Shared historical consumers require more than extraction readiness: the
read-only RPC surface includes `getindexinfo`. Before publishing a connection,
acceptance verifies an unpruned, IBD-complete source and `txindex.synced=true` with
`best_block_height` matching the canonical REST/source tip, plus resolvable
transactions/prevouts. See [testnet operations](docs/testnet-operations.md).
Read credentials never grant test-broadcast privileges.
