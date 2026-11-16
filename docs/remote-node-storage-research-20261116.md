# Remote BCH mainnet and Chipnet capacity research

Reviewed 16 November 2026. The user requests both mainnet and testnet estimates
and possible improvements. macOS remains excluded from node hosting. Research
does not authorize purchasing servers, deployment, or mainnet transactions.
Chipnet remains the project's selected test network; testnet3/testnet4/scalenet
are distinct chains and are not included in this budget.

## Recommendation

For independently hosted historical BCH services on both networks, start with
an **expandable 600 GB SSD allocation on Linux**, provisionally split into
500 GB for mainnet node/index services, 60 GB for Chipnet node/index services,
and 40 GB for OS, bounded logs and operating headroom. Mainnet's 500 GB allowance
includes room beyond the published BCHN/Fulcrum figures for BLAZE and growth;
it does not establish BLAZE's database size. Backup storage is separate.
GB here means decimal GB; 60 GB exceeds the earlier provisional 50 GiB Chipnet
budget. Volumes need not reserve this split physically if monitoring enforces
per-service limits and a shared free-space floor.

This is an initial engineering budget, not a measured production requirement or
a guarantee that the complete BLAZE index fits. A 1 TB volume offers more growth
room but is not established as a current minimum. An expandable volume avoids
buying the largest allocation before measuring. Budget 4 vCPU and 8 GB RAM as
a preliminary shared-host starting point; actual concurrent sync/index load
must be measured and may require more. Serialize initial sync/backfill work.

## Evidence and its limits

| Component | Publicly reported footprint | Interpretation |
| --- | --- | --- |
| BCH mainnet BCHN, with txindex | 256 GB, October 2026 | Operator's reported complete data directory; not our measurement |
| Mainnet Fulcrum | Additional 54 GB, same report | Address-history service, separate from BLAZE's token database |
| Chipnet sample | 4,367,750,091 bytes at height 332444 | Public node's block/undo size, not its complete data directory |
| BLAZE full mainnet/Chipnet index | Unmeasured | Must add actual database, WAL, recovery and backup requirements |

The Chipnet page is a retrieved public snapshot with preactivation MTP and a
prerelease node. It does not establish the current canonical tip, node health,
or a usable authenticated source. Other retrieved snapshots vary in height and
size; do not treat cached explorer numbers as live acceptance evidence.
BCHN documents `getblockchaininfo.size_on_disk` as block/undo files only.
Bitcoin Core/BTC storage estimates must not be substituted for BCH figures.

Sources:

- [BCHN/Fulcrum operator sizing](https://bchdroplet.com/)
- [Chipnet public node snapshot](https://chipnet.chaingraph.cash/node-status)
- [BCHN size_on_disk definition](https://docs.bitcoincashnode.org/doc/json-rpc/getblockchaininfo/)
- [BCHN pruning and transaction-index options](https://docs.bitcoincashnode.org/doc/cli/bitcoind/)
- [Distinct BCH test networks](https://docs.bitcoincashnode.org/doc/test-networks/)
- [14 November Chipnet upgrade notice](https://bitcoincashnode.org/nl/newsroom/2026-11-14_opinion_on_faster_blocktime)

## Improvements, in priority order

1. **Share each network's infrastructure across projects.** One mainnet node
   and one Chipnet node can serve the collection. Keep separate datadirs,
   databases, credentials, ports and chain-identity checks. Do not duplicate
   full chains for each app. On a shared host, also isolate service users and
   resources; sharing a machine does not mean mixing network state.
2. **Use existing remote sources first when an assigned source is available.**
   BLAZE already accepts remote extraction RPC and a separate historical RPC.
   This removes local blockchain retention but shifts cost and trust to that
   source. Public explorer pages are not authenticated RPC endpoints. No
   available production source or small complete-index capacity is established.
3. **Keep the existing compact schema.** Schema 4 already uses binary keys,
   compact token movement history and a finite spent-output undo window. Do
   not present these as new work or promise a percentage saving without real
   measurements. Full token history still grows with activity.
4. **Avoid unnecessary indexes.** BLAZE extraction uses `getblock(hash,2)` and
   does not itself require txindex. Keep txindex if a cohosted Fulcrum or other
   required consumer needs it. Do not disable it based on the indexer alone.
   Self-host address history once per network when required; omitting Fulcrum
   while relying on an external Electrum source changes infrastructure trust
   and availability, rather than eliminating the feature's cost.
5. **Implement coordinated pruning only as a separate enhancement.** A pruned
   node still independently validates, downloads historical blocks on initial
   sync, and retains chainstate. Its prune target is not a total disk cap.
   BCHN pruning conflicts with txindex. Before enabling it, implement durable
   extraction checkpoints, lag backpressure, disk watermarks, reorg/restart
   recovery and archive-backed historical reads. The coordinator is currently
   missing. Pruning today cannot replace the required historical explorer and
   wallet services without an additional history source.
6. **Measure, alert and bound growth.** Use the existing storage reporter on
   the remote host, including DB pages, indexes and WAL. Measure complete node
   datadirs separately. Alert at provisional 70%/80% used and stop ingestion
   before a verified recovery reserve is consumed. Set final thresholds from
   observed peak WAL, migration and recovery needs. Keep logs rotated; avoid
   duplicate container build caches and full-chain backup generations.
7. **Back up non-reconstructible state first.** Keep encrypted wallet secrets,
   configuration and consistent application database backups in separate
   storage. Do not copy a live SQLite database without its proper backup
   mechanism. Compress backups where useful; no compression ratio is assumed.
   A complete chain can be resynchronized, trading backup storage for recovery
   time and bandwidth. Restoring several services must be exercised.

Snapshots/exporters of current token UTXOs are another possible future bootstrap
optimization, but cannot recreate burns, genesis/authchain publications or full
NFT provenance. No all-token BCHN snapshot exporter is implemented here. Do not
use a current-state snapshot to claim complete historical coverage.

## Compatibility and next measurement

The maintainers' 14 November notice directs Chipnet operators to a specific
upgrade preview while mainnet/other testnets await a proper release. Select and
verify binaries per network; do not reuse the Chipnet preview for mainnet or
bypass expiry guards. The installed historical 29.2.0 is not a current Chipnet
solution. No binary or chain download was performed for this research.

After a host/source is assigned, collect authenticated chain/checkpoint and
version evidence, full datadir sizes, available storage and current resource
load. Run the existing storage reporter against an actual index on that host;
measure ingestion, WAL peaks, undo retention, reorg/restart and history queries.
Revise the 600 GB budget from those results before calling either network ready.
No synchronized node, deployed endpoint or readiness claim follows from this plan.

Local implementation references: [storage format](storage-v4.md),
[extraction and storage design](storage-and-extraction-plan.md).
