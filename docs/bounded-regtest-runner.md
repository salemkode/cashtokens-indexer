# Bounded REGTEST consumer runner — prepared, not executed

The separate `scripts/bounded_regtest.py` runner closes the old harness's
unbounded-tempdir/30-minute-lease source gap. Historical `test/serve-regtest.ts`,
its compiled copy, old connection reports and immutable tarballs are unchanged.
This runner has **not** created or mounted an image, started BCHN/REST, generated
transactions or emitted a measured endpoint. Current failed resource gate stands.
Neither testnetFunctionalReady nor publicReleaseReady is true.

## Future invocation, only after fresh execution authorization

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/bounded_regtest.py \
  --binary /Users/salmshmakh/.t3/projects/blaze/.build/runtime/bchn-preview-3e6827e95-20261115T125415Z-91ba97/bin/bitcoind \
  --node /absolute/path/to/already-installed-node24/bin/node \
  --lease-seconds 600
```

This is an execution command, not a status check. Do not run it now or repeatedly
poll resource changes. No installation/download/compile occurs. Admission checks
normal pressure, non-rising swap/no active heavy compiler, at least12 GiB free,
adequate reclaimable-page estimate, no existing native node and exact parent
identity **before** creating a run directory, image or process. It validates the
pinned daemon, Node24 and all intended compiled runtime files against the retained
artifact; any byte mismatch refuses rather than rebuilding. It never accesses
or restores the archived Chipnet image.

Each future run uses a NEW0700 control directory and a NEW fixed96 MiB image via
`bounded_store.create_store`. BCHN data, wallet, SQLite and temporary files stay
inside that owned image. No unrestricted datadir argument or existing-node URL is
accepted. Wallet generation/mining/signing applies only to isolated regtest coins
once native genesis/chain/zero peers are verified; no treasury/user wallet exists.

## Lifetime, ownership and resource boundaries

Lease input is a finite integer60..1200 seconds, default600, **including setup and
stop margin**. A handoff is refused unless at least2 minutes remain. A native
watchdog deadline30 seconds before final expiry leaves clean-stop margin. The
worker also enforces its own expiry; no automatic restart or rebroadcast exists.
A normal operator stop sets the owned stop request. Owner receipt/stop namespaces
for native and consumer are distinct, preventing a native stop claim from hiding
a REST worker stop.

The existing `owned_node.py` guardian is reused under the explicit
`bounded_consumer_regtest_v1` profile. It verifies UID/PID/birth/kernel executable/
full argv/datadir/cookie/listener, parent identity, fresh private parent heartbeat
and native network/genesis/expiry. Parent pulses are bounded to128 KiB; missing or
stalled pulses stop the target. The parent independently watches guardian counter
progress and uses the same exact-owner stop helpers if the guardian is lost.
The REST worker must be registered with exact identity before it does fixture
work; an unregistered worker exits after5 seconds without serving.

Peer connections, inbound listening, DNS discovery/seeding, UPnP and NAT-PMP are
disabled, with maxconnections0/connect0. Any observed connection or P2P receive/
upload byte stops this profile. Local cookie RPC is owner-only; MCP receives REST
only, with no wallet/RPC credential or mutation endpoint. The REST process uses
exact-owner SIGTERM without forwarding a BCHN cookie to an HTTP stop route.

Sampling stops at free space below9 GiB (8 GiB reserve plus headroom), native RSS
above256 MiB, consumer RSS above256 MiB, swap growth above512 MiB, non-normal
pressure, native RPC failure, ownership loss or bounded log/counter exhaustion.
Each native/consumer stdout is drained with at most4 MiB retained. Total owned
allocation stops at120 MiB, leaving headroom below128 MiB. The image is a
fixed allocation boundary; RSS/free/scheduling thresholds remain sampled, not hard
CPU/RSS quotas. No SIGKILL, force detach, recursive deletion or foreign cleanup is
implemented. Ambiguous process exits/ownership/mount binding block detach and
require owner review; do not claim a hard kill-time guarantee under such failures.
The image/logs/receipts remain for evidence after normal owned detach.

Only the source owner may create the private `consumer-done.json` marker after the
consumer explicitly reports completion; clients never mutate node lifecycle.
Otherwise the finite lease stops both processes. Original connection evidence is
immutable; `lifecycle-receipt.json` records termination and endpoint withdrawal.

## Exact existing-MCP-archive handoff

The fields match the consumer owner's read-only specification in
`projects/bch-mcp/docs/existing-archive-acceptance.md` and
`projects/bch-mcp/scripts/accept-existing-archive.mjs`; those files were not edited.
`bounded-regtest-contract.mjs` validates the owner emission boundary. Future output
is a new private `connection.json`, **not this preparation document**:

- `status`, `network`, ISO `measured_at`/`expires_at`, loopback credential-free
  `rest_url`, `resource_gate:{passed,normal_pressure}`.
- `ready:{genesis_hash,schema_version,tip:{height,hash}}`, category, confirmed txid,
  bchreg address and `prevout:{resolvable,expected_output:{output_index,
  value_satoshis,locking_bytecode}}` with plain lowercase script hex.
- Actual activity coverage `{start_height,token_state_status,
  gross_fungible_details_start}` and1–50 exact `expected_rows` using MCP's fieldnames.
- `acceptance_complete:true` only after ready/source/genesis/schema/activity/prevout
  comparisons pass. `snapshot409` explicitly stays **NOT_EXECUTED**; no manufactured
  hash or snapshot mutation is included.

The new worker reuses the existing actual-regtest scenario recipe: own101 mined
blocks, category parent, >2^53 issuance with all three NFT capabilities and BCMR
publication, then an input-only burn of9007199254740993. Every token submission is
signed/decoded locally, its raw SHA256d txid is independently computed, exact bytes
and txid are journaled before a single send, and native acceptance/confirmation is
checked. Expected issuance is summed from native decoded outputs; expected burn
comes from the actual spent native output and absence of token outputs. Prevout
value/script come from the independently hashed raw native parent, never API echo.
No actual transaction was generated in this code-only checkpoint.

The worker uses the unchanged compiled API/SQLite modules, scans fresh regtest
from0, validates actual envelopes, compares independent expectations, checks real
snapshot-pinned paging and the transaction's resolved inputs, then measures HTTP
ready/genesis/schema/tip before publishing. The owner advertises only that measured
contract path/URL. Initial readiness failure publishes no contract. Native source
is rechecked during the lease; stale source/parent/expiry closes serving.

## Small supporting checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s test -p 'test_bounded_regtest.py' -v
node --test test/bounded-regtest-contract.test.mjs
```

Ten control tests +four pure contract checks passed, plus four affected existing
owner-stop/process-fixture regressions. Policy tests use mocked resource and
fixed-image state with tiny files; they do NOT create a96 MiB image or probe the
host. Contract fixtures are synthetic and in-memory only, never measured handoffs.
Syntax checks do not execute the activity worker. Full runner, actual image/wallet/
activity fixture and installed RC2 consumer acceptance remain **NOT EXECUTED**.

## Pinned preview maturity profile admission

The later [source audit](preview-regtest-maturity-audit.md) narrows the producer to
verified **pre2027 regtest** native tick/activation facts. Its101 funding/104 total
blocks are not a universal preview assumption. Unknown, post-rule or crossing
lease profiles fail before funding/mining; no1001-block expansion, activation/
expiry/mocktime override or coinbase-check bypass is supported. The future worker
records measured profile facts, native coinbase tick-depth/UTXO checks and disables
implicit BIP68 assumptions in its own raw fixture transactions. This additional
source-only cohort has six pure/mock checks; original18 checks were not rerun.
