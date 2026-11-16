# Six-core, 16 GB server: setup, 12-hour sessions and acceptance

Target: AMD CPU with 6 cores, 16 GB RAM, GPU unused, roughly 900 GB **total** disk
capacity. Linux and existing files consume part of that capacity. Disk type,
distribution, actual free space and connection speed are not yet measured.
Run these instructions on the assigned Linux machine, never on the Mac.
Nothing in this handoff has deployed or started a node on either machine.

## Fast initial setup without wasting daily progress

Use a local SSD/NVMe for both BCHN chainstate and SQLite. An HDD can make the
many database flushes much slower; extra CPU/GPU cannot compensate. Do not put
the live SQLite database on NFS/SMB. Keep durable SQLite WAL/FULL settings; do
not turn off fsync or expiry/consensus guards to make a benchmark look faster.

The starting profile is 4096 MB mainnet BCHN cache and four verification threads,
256 MB Chipnet cache and one thread, and a two-core/2 GiB limit with 1024 MiB JS
heap for **each** BLAZE indexer. These are configuration allowances, not a total
host memory guarantee. Nodes have other memory overhead and caches; reserve
space for the OS, Docker, filesystem cache and other applications. Stage the
heavy jobs. Do not maximize all caches or run both initial backfills together.

Initial BCH history transfer is hundreds of GB for mainnet. Pruning still
downloads/validates history and would break this archival feature plan. Chain
download, validation and token indexing are separate costs. A preexisting trusted
remote archive can avoid initial local node synchronization if available, but
adds dependency/trust and must pass the same acceptance checks. No such endpoint
is assigned. Do not substitute an explorer page or an unverified snapshot.

Full metadata coverage scans from height 0. An activation-height scan can be
faster but deliberately loses earlier metadata coverage; it is not silently
enabled. BLAZE already yields to API requests while catching up and skips its
idle poll delay while making progress. Enlarging a batch is not a substitute for
measuring disk/RPC bottlenecks. No live throughput claim has been established.

## Stage 1: identify the real disk, paths and prerequisites

Install Docker Engine/Compose for your actual distribution, Python 3 and Node 24
if running the offline source tests. Use the official distribution instructions;
package installation commands differ between Debian/Ubuntu and other systems.
The runtime container itself provides Node 24.

Verify the large disk's mount before creating service directories. The examples
below assume the large disk is available at `/srv`. If it is mounted elsewhere,
adapt all paths, including the systemd template, before installing it. Do not
format a disk or silently move existing application data for this setup.

```sh
findmnt -T /srv
df -h /srv
lsblk -d -o NAME,ROTA,TRAN,MODEL
timedatectl status
python3 deploy/server/ops.py inspect --storage-path /srv --report server-reports/initial-hardware.json
```

The read-only inspector reports actual free space, CPU affinity, Linux memory,
swap, media inventory and provisional tuning. It never starts Docker or nodes.
Allow at least 600 GB **free** for the initial combined plan; index sizes remain
unmeasured. The starting 90 GB ingestion floor reserves approximately 10% of a
900 GB disk; alert when free space falls below 20%. Neither is a hard filesystem
quota. Backups on this disk consume this same capacity, and an off-host backup
is needed for disk-failure recovery. Check the backup filesystem separately.

Copy all three env examples as described in [README](README.md), then set
`BLAZE_DATA_ROOT` and `BLAZE_BACKUP_ROOT` to real absolute paths. Prepare the
chosen indexer directories for the Node image's UID/GID 1000. For these example
paths, on a **new** deployment only:

```sh
sudo install -d -o 1000 -g 1000 -m 0750 /srv/blaze-data/mainnet /srv/blaze-data/chipnet
sudo install -d -o 1000 -g 1000 -m 0750 /srv/blaze-backups/mainnet /srv/blaze-backups/chipnet
./deploy/server/blaze config --quiet
./deploy/server/blaze build mainnet
```

The GitHub checkout defaults to a source build inside Docker. A separate verified
compiled handoff can select `BLAZE_DOCKERFILE=Dockerfile.runtime` to skip TypeScript
and dev dependency installation in the image. Source, lockfile and offline tests are included too.
No huge chain archive is in the handoff. Both services use one locally built
image. Validate disk paths, mounted filesystems and permissions before starting.

## Stage 2: prepare dedicated archival nodes

Use one node per network across all BLAZE projects. Download official Linux
x86_64 binaries for this AMD machine. Verify archive digests and maintainer
signatures where supplied, and retain version/source/digest records. Chipnet
currently requires its separately maintained upgrade-compatible preview; do
not reuse it on mainnet or disable expiry checks. See the linked notice in
README. Automatic selection of a current binary is intentionally not claimed.

Prepare the following layout (substitute verified binary paths):

```text
/opt/blaze/bchn/mainnet/bin/bitcoind
/opt/blaze/bchn/mainnet/bin/bitcoin-cli
/opt/blaze/bchn/chipnet/bin/bitcoind
/opt/blaze/bchn/chipnet/bin/bitcoin-cli
/srv/bchn/mainnet/bitcoin.conf
/srv/bchn/chipnet/bitcoin.conf
```

Create a dedicated system account `bchn` if one does not already exist. Create
both datadirs owned by that account with mode 0700; install configs mode 0600.
The provided `bchn-*.conf.example` templates disable wallets, retain history,
enable txindex, bind RPC to loopback and restrict the BLAZE RPC usernames to
read-only methods. Set distinct strong random RPC passwords and match each
private indexer env file. Never use the example placeholders. The node's local
cookie remains an administrative credential; do not publish it. A later Fulcrum
installation needs its own credential/permissions and storage allowance.

Install the supplied systemd template only after its paths and binary versions
are correct:

```sh
sudo install -m 0644 deploy/server/blaze-bchn@.service /etc/systemd/system/blaze-bchn@.service
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/blaze-bchn@.service
```

If your disk paths differ, edit the source template and installed copy together:
the daily stop helper verifies that the running unit's template matches this
deployment before signaling anything. Node logs go to journald instead of an
unbounded duplicate debug.log. Configure an appropriate system-wide journal
budget only after reviewing other services' retention needs.

Do **not** enable automatic boot startup while the machine is operated only in
daily sessions. Schedule the stop timer before each start. The systemd service
allows five minutes for SIGTERM and has no automatic SIGKILL fallback.

## Stage 3: each day's session

Before starting services, schedule a one-shot stop at 11 hours 30 minutes. Use
the absolute path of this extracted deployment; the timer runs even if the SSH
session disconnects. Example from the extracted project root:

```sh
sudo systemd-run --unit="blaze-daily-stop-$(date +%s)" --on-active=11h30m "$(pwd)/deploy/server/session-stop"
```

This timer stops only matching `blaze-server` indexers and the matching dedicated
`blaze-bchn@mainnet`/`@chipnet` units. It never powers off Linux, stops foreign
nodes/containers, deletes data or force-kills a stuck process. Check its journal
and verify processes exited before manually powering off. An ownership mismatch,
stop failure or remaining process needs inspection; do not blindly repeat the
stop or cut power. Do not update the deployment/unit templates mid-session.

Choose one heavy stage at a time:

1. Chipnet first gives the quickest test-network feedback; synchronize its node,
   complete its txindex, then start its indexer and verify it. Keep that small
   service available only if resources permit while mainnet syncs.
2. Mainnet initial synchronization: `sudo systemctl start blaze-bchn@mainnet`.
   Leave its BLAZE indexer stopped during the initial node sync for the first
   measured run. This avoids competing for disk and helps locate the bottleneck.
3. After BCHN reports `initialblockdownload=false` and txindex `synced=true`, start
   `./deploy/server/blaze up -d --no-build --pull never mainnet` to backfill BLAZE.
4. Use the corresponding `blaze-bchn@chipnet` and `chipnet` service names for
   Chipnet. Follow README for API health/readiness and private connections.

Inspect node progress without exposing RPC credentials in commands:

```sh
sudo -u bchn /opt/blaze/bchn/mainnet/bin/bitcoin-cli -datadir=/srv/bchn/mainnet getblockchaininfo
sudo -u bchn /opt/blaze/bchn/mainnet/bin/bitcoin-cli -datadir=/srv/bchn/mainnet getindexinfo txindex
./deploy/server/blaze logs --tail 20 mainnet
```

Record node height/verification progress and later indexer height at the start
and end of each session. Estimate remaining work from the actual stage's rate;
do not extrapolate token indexing from node download speed. Confirm system time
is synchronized before relying on freshness checks.

Start only the needed instance; inspect its state before repeating a start.
Existing node and SQLite progress persists across days. Next day, schedule a
fresh timer, start the same dedicated node and indexer as appropriate, and
continue against the same directories. The stop helper disables each owned
container's restart policy before signaling it, so it cannot race back to life
during shutdown. Next day's indexer command is
`./deploy/server/blaze up -d --force-recreate --no-build --pull never mainnet`
(or `chipnet`), after confirming the previous session stopped. This recreates
only the container with the same image/data paths and restores its bounded
failure-restart policy; it does not reinstall or reset the database.
**Do not delete data, reindex, restore a
blank database or reset the scan height as part of daily startup.** Initial
download validation and txindex construction also resume from retained state.

You may stop early with `sudo ./deploy/server/session-stop`. Before the next
session check any remaining timers with `systemctl list-timers 'blaze-daily-stop-*'`.
Cancel only an obsolete timer you identify as belonging to this deployment.
Transient timers do not survive a machine reboot: schedule a new one each day.

This supports repeated 12-hour windows but cannot promise that full mainnet
delivery fits into any fixed number of days. Measure useful progress and energy
on your machine. Stable network, SSD/NVMe and avoiding duplicate work matter
more than GPU or unsafe database settings.

## Stage 4: offline regression checks before live acceptance

With initial heavy jobs stopped, run `./deploy/server/test-offline` once on Linux.
It installs the lockfile dependencies without install scripts, compiles and runs
the TypeScript suite serially. It explicitly unsets `BCHN_TEST_BINARY`, so native
node integration is skipped. Mock-backed API lifecycle tests run only against
their local fixtures; they do not contact Chipnet or mainnet. Python server
operations tests run separately. Retain the summary and Node/Docker versions.

Native regtest, mining, test-wallet funding and transactions are **not** part of
this offline recipe. Do not run the old macOS node/image supervisor scripts as
a Linux deployment shortcut. Any later transaction tests require dedicated
Chipnet identities/coins and the existing approval policy; never real funds.

## Stage 5: live read-only acceptance after catch-up

Run for each network using a real category with 1–50 live token UTXOs. This
small sample limit bounds work. Prefer a fungible category and then an NFT
category; repeat with separate unused report names. Use public category IDs,
never seed phrases or wallet secrets:

```sh
./deploy/server/blaze exec -T mainnet node dist/scripts/server-acceptance.js --category REAL_MAINNET_CATEGORY --report-file /app/backups/acceptance-mainnet-1.json
./deploy/server/blaze exec -T chipnet node dist/scripts/server-acceptance.js --category REAL_CHIPNET_CATEGORY --report-file /app/backups/acceptance-chipnet-1.json
```

The checker requires height-0 metadata coverage and validates native network,
genesis and BCH-specific checkpoint (including Chipnet/testnet4 separation),
fresh matching API/native tips, schema, archive/txindex readiness, sample exact
supply and NFT counts, every sampled UTXO against BCHN, a historical transaction
with a resolved prevout, activity/blocks/mempool contracts and connected peers.
Requests are read-only, responses bounded, overall deadline two minutes.
Reports are private and never overwrite a prior file. Tip/UTXO movement can
invalidate a sample; inspect the reason and rerun the reads after catch-up.
There is no transaction submission, automatic retry or readiness-flag promotion.

## Stage 6: bounded performance checks and daily recovery

Start at one worker for 60 seconds, then four workers for five minutes if the
host remains healthy. The probe reads ready/status/activity only, sends at most
two requests per worker per second, caps concurrency at eight and duration at
ten minutes, checks the network and fails on errors/readiness loss. The 1000 ms
p95 limit is a provisional acceptance target, not a measured performance claim:

```sh
python3 deploy/server/ops.py probe --url http://127.0.0.1:3001 --network mainnet --duration 60 --concurrency 1 --report server-reports/mainnet-read-1.json
python3 deploy/server/ops.py probe --url http://127.0.0.1:3001 --network mainnet --duration 300 --concurrency 4 --report server-reports/mainnet-read-4.json
```

Repeat on port 3101 for Chipnet with separate reports. Also inspect Docker
memory/CPU, node RSS, disk latency/utilization, swap growth, disk reserve and
index backlog before/after. `docker stats --no-stream`, `vmstat 1 5` and, if
installed, `iostat -xz 1 5` are useful observations. Stop increasing load if swap
grows or I/O saturates. This probe measures warm lightweight reads; separately
time real block detail, known transaction, token holders/NFT pages and explorer
network switching. No script automatically changes CPU governors or OS limits.

Perform a clean early session stop, then next session resume and rerun acceptance
on both networks. Confirm the same DB paths, schema and coverage, progress from
the saved tip, eventual readiness, and no duplicate writer or reset to height 0.
This daily restart is part of acceptance, not an emergency rescan.

## Stage 7: backup and restore rehearsal

After catch-up, use unique backup names per network:

```sh
./deploy/server/blaze exec -T mainnet node dist/scripts/database.js --action backup --database /app/data/cashtokens.sqlite --destination /app/backups/mainnet-checkpoint-1.sqlite
./deploy/server/blaze exec -T mainnet node dist/scripts/database.js --action check --database /app/backups/mainnet-checkpoint-1.sqlite
./deploy/server/blaze exec -T mainnet node dist/scripts/database.js --action restore --database /app/backups/mainnet-checkpoint-1.sqlite --destination /app/backups/mainnet-restore-rehearsal-1.sqlite
./deploy/server/blaze exec -T mainnet node dist/scripts/database.js --action check --database /app/backups/mainnet-restore-rehearsal-1.sqlite
```

Repeat for Chipnet; plan space for a backup **and** a separate restored copy.
The online backup includes committed WAL, validates integrity/foreign keys and
refuses to overwrite. The rehearsal never replaces the live DB. Compare network,
start/schema and sample data on the restored copy before relying on recovery.
Do not copy only an active SQLite main file, make a full-chain copy every day,
or blindly vacuum a large live DB. Transfer a verified backup off-host and test
its decryption/restore if you encrypt it. Review/delete only identified obsolete
backup generations once a newer backup and restore have been verified.

Retain hardware/version/digest reports, per-network acceptance and latency
reports, restart observations, backup/restore evidence and explorer journeys.
These establish what actually worked on this machine. Neither readiness flag
is set merely because offline tests, one category or one warm probe passed.
