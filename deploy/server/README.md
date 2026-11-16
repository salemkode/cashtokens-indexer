# BLAZE on your Linux server

These files run the **BLAZE indexer/API** separately for mainnet and Chipnet.
They do not automatically start BCHN, fund wallets, broadcast transactions or
publish an explorer. Optional dedicated BCHN templates and daily shutdown
instructions are in the [12-hour-session runbook](RUNBOOK.md). No blockchain or
indexer needs to run on your Mac.

The source builds and supports offline verification, but actual synchronized
mainnet/Chipnet operation is not yet accepted. Do not interpret a successful
build or container healthcheck as complete live-chain verification.

## 1. Server prerequisites

- Linux with Docker Engine and Docker Compose v2+. This deployment uses Linux
  host networking so the containers can reach server-local loopback RPC.
- An expandable SSD. The current provisional combined budget is 600 GB, with
  backups separate. Actual BLAZE database sizes are unmeasured.
- Your target profile: 6 CPU cores, 16 GB RAM, about 900 GB total disk capacity,
  and 12-hour daily sessions. Actual free space and disk type must be checked.
  The GPU is not used. Run initial sync/backfill stages serially.
- One updated, synchronized BCHN source per network, retaining all history from
  height 0 for the supplied complete-history configuration. Mainnet RPC defaults
  to 127.0.0.1:8332; Chipnet to 127.0.0.1:48332. Use separate data directories,
  configurations and credentials. Keep RPC private.
- For the enabled historical BCH pages, each source must be unpruned with
  `txindex=1` fully synchronized, or configure an independent same-network
  `BCH_HISTORY_RPC_URL` with its own credentials. Token extraction alone does
  not require txindex. General address history requires a separate Electrum
  service such as Fulcrum; it is not supplied by this compose file.

Download and verify BCHN binaries from the official maintainers. **Select
versions separately:** the [14 November 2026 notice](https://bitcoincashnode.org/nl/newsroom/2026-11-14_opinion_on_faster_blocktime)
directs Chipnet to an upgrade preview and mainnet/other testnets to the proper
release. Do not use the Chipnet preview on mainnet, start expired 29.2.0 on
current Chipnet, or disable expiry guards. This compose deliberately does not
automatically choose or download a node binary.

## 2. Copy source and configure

For a fresh checkout of the private repository:

```sh
git clone --branch feature/cashtokens-indexer https://github.com/salemkode/blaze.git
cd blaze
```

Authenticate Git on the new machine with your own GitHub account. The default
tuning template builds from source inside Docker; no host Node.js installation
or preexisting `dist/` is required for the container build.

Extract the latest supplied source-and-compiled archive into a new server directory, or copy this
checkout without `.build`, `node_modules`, local databases, secrets or `projects`.
Run all following commands **on the Linux server**, from the extracted root.

```sh
umask 077
cp -n deploy/server/mainnet.env.example deploy/server/mainnet.env
cp -n deploy/server/chipnet.env.example deploy/server/chipnet.env
cp -n deploy/server/tuning.env.example deploy/server/tuning.env
chmod 600 deploy/server/mainnet.env deploy/server/chipnet.env deploy/server/tuning.env
```

Edit both private `.env` files with their respective server RPC credentials and
actual explorer origins. Replace every password placeholder. Single-quote
literal passwords containing `$` or `#` so Compose does not interpolate them.
Real env files are excluded from Git and Docker build contexts. Do not paste
rendered Compose configuration or credentials into shared logs.

Set the absolute large-disk data and backup paths in `tuning.env` and prepare
the directories using the [runbook](RUNBOOK.md). They must exist and be writable
by container UID/GID 1000. Compose refuses to create missing paths.

Both network templates start at height 0 for complete metadata coverage. Mainnet
792773 and Chipnet 121957 are optional first-CashTokens boundaries for token
scans, but earlier metadata/authchain coverage then remains incomplete. Choose
before first start; changing height/network against an existing database is
rejected. Each service has a separate explicit database directory on your chosen disk.

## 3. Validate, build, then start one network

```sh
./deploy/server/blaze config --quiet
./deploy/server/blaze build mainnet
./deploy/server/blaze up -d --no-build --pull never mainnet
./deploy/server/blaze logs --tail 100 mainnet
```

The source Dockerfile compiles inside Node 24 and copies only the production
runtime/dependencies into its final image. For a verified compiled handoff,
`BLAZE_DOCKERFILE=Dockerfile.runtime` skips compilation and installs only
production dependencies. Git excludes compiled files; do not select the runtime
Dockerfile from an unbuilt clone. Building does not download blockchain data. Starting
the indexer begins RPC reads/backfill against the configured existing node.
No test broadcast or RPC proxy is configured by these templates. Do not add
test-broadcast credentials to the mainnet service.

Verify the first network locally on the server:

```sh
curl --fail --silent --show-error http://127.0.0.1:3001/healthz
curl --fail --silent --show-error http://127.0.0.1:3001/readyz
curl --fail --silent --show-error http://127.0.0.1:3001/v1/status
```

`/healthz` checks process liveness; `/readyz` returns 503 while catching up or on
sync errors. Wait for readiness and verify the reported network, committed tip
and coverage before routing explorer traffic. A Docker "healthy" status checks
liveness only. Observe disk, RAM and RPC load during backfill.

Once mainnet backfill is complete and resources allow, start Chipnet using the
same image:

```sh
./deploy/server/blaze up -d --no-build --pull never chipnet
./deploy/server/blaze logs --tail 100 chipnet
curl --fail --silent --show-error http://127.0.0.1:3101/readyz
curl --fail --silent --show-error http://127.0.0.1:3101/v1/status
```

You may start Chipnet first instead. These commands start each service once;
investigate an ambiguous result with `docker compose ... ps` and bounded logs
before repeating it. Check authenticated node chain/checkpoints, real known
token/block/transaction results and explorer integration on both networks.
Readiness alone does not establish all user journeys or production capacity.

## 4. Exposure, backups and stopping

The APIs bind only to server loopback (3001 mainnet, 3101 Chipnet). Put an HTTPS
reverse proxy on the same host in front of them. Keep BCHN RPC inaccessible to
the public. Explorer public variables contain API origins, never RPC secrets.
Use separate `NUXT_PUBLIC_CASHTOKENS_API` and
`NUXT_PUBLIC_CASHTOKENS_CHIPNET_API` values, without `/v1` suffixes, and configure
the required network-specific Electrum URLs.

Back up each SQLite database using the documented online backup tooling or a
consistent stopped-writer backup; do not copy just its live WAL-mode main file.
Logs are rotated and containers have memory/process limits. The provisional 90 GB
`MIN_FREE_BYTES` floor stops ingestion before a low-disk write, but is not a
hard whole-host disk limit. Monitor node/index/WAL growth and disk reserve.

```sh
sudo ./deploy/server/session-stop
```

This stops only matching indexers and dedicated BCHN units, preserves data, and
never powers off the host or force-kills a process. See the timer setup and
next-day container restart instructions in the runbook. Do not run another indexer against
either database directory, delete it, or treat a fresh empty directory as resume.

More details: [storage research](../../docs/remote-node-storage-research-20261116.md),
[database/recovery format](../../docs/storage-v4.md),
[operations and acceptance](../../docs/testnet-operations.md).
