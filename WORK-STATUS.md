# Blaze Indexer — execution checkpoint

## Current server preparation — daily sessions on the user's Linux machine

Target hardware is 6 reported AMD CPU cores, 16 GB RAM and roughly 900 GB total
disk; actual free space/media/distribution remain unmeasured. Prepared compiled
runtime plus source, explicit data/backup binds, isolated networks, conservative
resource tuning, dedicated archival node/unit templates and a graceful 11.5-hour
stop workflow with next-day retained-data resume. GPU is unused.

Read-only two-network acceptance, bounded latency probes and a staged Linux
offline/live/restart/backup/restore plan are in [RUNBOOK](deploy/server/RUNBOOK.md).
Node 24.18.0 build, 96 source cases, 20 operations/packaging cases and 20 overlapping
production-only compiled cases pass. No server/node/API/container was started.
[Evidence and exact remaining checks](docs/server-session-preparation-20261116.json).
Both readiness flags remain false; no mainnet transaction or deployment took place.

## Server handoff — 16 November 2026

The user will run BLAZE on their own server; macOS node hosting is excluded.
Prepared Linux-only mainnet/Chipnet Compose services, separate private env
templates and data volumes, loopback-only API bindings and server startup
instructions in [deploy/server](deploy/server/README.md). Example start height
is now 0 for complete metadata scans. No server, container, API or node started.

Node24.18.0 compilation, Compose parsing/isolation checks, actual compiled
configuration-schema checks and24 offline SQLite cases passed. No full suite,
Docker image build, fresh dependency install or live-chain acceptance ran.
[Verification scope](docs/server-offline-verification-20261116.json).
Both readiness flags remain false; server node prerequisites and live acceptance
remain required. Historical local resource windows below do not authorize any
further macOS node start.

## Current result — distinct reviewed attempt refused on measured memory pressure; END

The narrow diagnostic fix passed5 deterministic mocked cases; approved MCP
profile alignment passed8 affected pure contract/isolation cases. Prior wrapper
was privately snapshotted; [new hashes/test record](docs/bounded-prestart-diagnostics-fix-20261116.json)
is additive. No guard/threshold/owner/profile-maturity/runtime API redesign.
Producer profile now depends on actual regtest genesis/chain, owned no-peer argv,
fresh getconnectioncount0/getpeerinfo[] checks; no static caller isolation claim.

The separately reviewed single actual CLI then exited2 at **resource_admission**:
`memory_pressure_not_normal`, pressure2 in BOTH samples. Free space
24,736,260,096→24,736,092,160bytes passed12GiB, swap7,454,913,986 stayed unchanged,
heavy compiler counts0, parent presence/UID/birth/argv/executable facts passed.
[Exact sanitized receipt and actual attempt evidence](docs/bounded-regtest-diagnostic-refusal-20261116.json).
This explains only the NEW attempt; the prior refusal remains unknown.

**END reserved source window**, root notified. No run directory, image/mount,
BCHN/REST/guardian, lease/mining or endpoint was created; no repeated gate/start.
No MCP path handoff or installed-consumer acceptance occurred. No stop receipt
applies because no target process started. Actual cold Chipnet archive/stage2
claim remain untouched. Both readiness flags are **false**; current validating
Chipnet/source and25GiB+root-review full-sync restrictions remain unchanged.

## Historical first actual REGTEST refusal — reason not retained

The single released invocation of the frozen atomic wrapper (lease1200) exited2
with only **"Bounded REGTEST refused before startup; no endpoint advertised."**
No bounded run directory was created; therefore no image/mount/native node/REST/
guardian/lease/mining started. Frozen hashes matched immediately before execution.
No second probe, startup or source edit followed this refusal. No MCP handoff exists.

[Additive actual-refusal evidence](docs/bounded-regtest-actual-refusal-20261116.json).
The exact failed admission stage/reason was **not retained**: the broad CLI catch
suppresses GuardError details and its resource receipt is written only after
admission/runtime checks. This is an observed diagnostic gap; pressure/availability/
ownership/Node version must not be guessed or reconstructed from a new probe.
The minimal grounded fix is sanitized pre-start stage/reason/sample persistence,
not a harness redesign or a blind retry. Historical tested hashes remain unchanged.

Actual ninth-tool consumer acceptance remains **NOT EXECUTED**. No process stop
receipt applies because no target processes started. Actual cold Chipnet image
and stage2 claim are untouched; both readiness flags remain **false**. No validating
Chipnet source or full-sync permission is established;25GiB+root review still apply.

## Historical atomic handoff tests and frozen hashes

After root explicitly ended the OX bootstrap test window, only the four Python
and four JavaScript tiny publication tests ran, serially. **8/8 passed; no fixes
were needed.** Concurrent readers saw complete JSON, final names stayed absent
through paused partial writes/fsync, interrupted producers left no partial final,
and existing file/symlink targets were not replaced.

[Additive test receipt and frozen current hashes](docs/atomic-handoff-test-receipt-20261116.json)
cover wrapper/worker, dedicated publishers and focused test fixtures. Pretest
candidate hashes match. Per-command time-l maximum RSS was30,572,544bytes (Python)
and56,557,568bytes (JS); these are command rusage, not whole-host idle evidence.
Owned tiny fixture allocation is recorded below128 MiB. Node parent/child heap
limits were96 MiB each; commands ran serially.

No actual BCHN/native/HFS/image/mount/API/lease/mining/P2P or resource gate ran.
No unaffected suite/build/pack/install ran. Old native/receipt/profile/runtime
artifacts and global guard.save_new remain unchanged. Actual REGTEST is still
**NOT RELEASED / NOT EXECUTED** until separate root release and a fresh successful
own-source normal-pressure12 GiB gate. Both readiness flags remain **false**;
shared Chipnet and25 GiB+root-review full-sync conditions are unchanged.

## Historical atomic source preparation — tests were deferred

Only `consumer-owner.json` and `connection.json` publication changed, through
separate Python/JS helpers: exclusive same-directory private temp, complete write/
fsync, atomic no-clobber final link, parent fsync and own-temp-only cleanup.
Global guard.save_new, existing readers/ownership, gates, profile/maturity and
runtime API are unchanged. Historical evidence remains intact.

Four Python +four JavaScript tiny fixture/process cases are **written, NOT RUN**.
No syntax/test execution, resource probe, native/datadir/image/mount/API/lease/
mining/P2P, build/pack/install occurred. The bootstrap window is still reserved.
[Source preparation and deferred commands](docs/atomic-handoff-preparation.md).
Current hashes are a pretest snapshot, not a passed-test freeze; additive final
hashes and small test receipt follow only after explicit root test release.

Both readiness flags remain **false**. Actual REGTEST still requires separate
root window release and fresh successful normal-pressure12 GiB gate; shared
Chipnet is unavailable and25 GiB+root review full-sync restrictions remain.

## Historical pinned preview maturity audit

Pinned preview coinbase maturity is **60,000 block ticks**, not unconditionally
100 block heights. Regtest's default2027 activation is1810382400 (May2027), while
Chipnet's is1794744000 (November2026). The stored Electrum MTP is Chipnet context
only; it does not prove failure of101-block funding on pre2027 default regtest.

The bounded worker now verifies the exact native/source pre-rule profile before
funding/mining, caps generation at104 total, checks native maturity facts and raw
sequence/locktime assumptions. It explicitly refuses unknown/post/crossing2027
profiles with precise errors rather than mine1001 blocks or override consensus.
[Exact source audit, anchors and limitations](docs/preview-regtest-maturity-audit.md).

**Six new pure/mock tests passed**, plus worker syntax parsing only. The prior18
checks remain historical, not rerun. No native executable, RPC/resource probe,
image operation, build/download, source CLI, live transaction or sibling edit.
Actual cold archive, historical records and47 runtime API bytes are preserved.
No node/endpoint is advertised; both readiness flags remain **false**.

## Historical bounded REGTEST runner preparation

A separate `scripts/bounded_regtest.py` runner now reuses the fixed-image and
exact-owner guardian/stop helpers with a finite<=20minute lease, private parent
heartbeat, native/REST identity registration, zero external peer traffic,
logs/RSS/free/pressure controls and independent stop paths. Historical serve
runner semantics/records and all47 compiled runtime API bytes remain unchanged.
Admission refuses **before** directory/image/process creation on failed resources.

Future handoff fields align with MCP's actual immutable-archive preparer. The
worker must derive native raw-transaction issuance/input-only>2^53 burn/prevouts,
then compare ready/genesis/schema/tip/activity/pinned paging before emitting a
measured `connection.json`. Snapshot409 stays explicitly NOT_EXECUTED.
No statusverified/known-object/endpoint file was emitted in this preparation.

**10 small control tests +4 pure contract tests +4 affected owner-stop checks
passed.** Mocked control fixtures allocated409,600bytes; no real fixed image,
mount/detach, native process, activity worker, resource probe or heavy/JS build.
[Prepared invocation, boundaries and evidence](docs/bounded-regtest-runner.md).
Full runner and ninth-tool actual-node acceptance remain **unverified**. The prior
REGTEST resource gate still failed pressure; no retry was performed. Both readiness
flags remain **false**, shared Chipnet source **unavailable**. Actual archived
Chipnet image and stage2 process claim remain untouched.

## Historical MCP ninth-tool REGTEST gate

The separately authorized supporting REGTEST gate failed **normal memory pressure**
in both fresh samples (pressure2). Free space14,499,065,856bytes passed12 GiB,
swap stayed stable, and no active heavy compiler/existing native node was observed.
**No datadir, mount, node, REST process or lease was created; no automatic retry.**
This was not a Chipnet quiet/stage2 retry. Actual Chipnet archive stays untouched.

Read-only provenance matched the intended runtime source hash and immutable
installed-artifact SHA256. All47 actual `dist/src` runtime/map/schema members
matched the retained tarball;47 AppleDouble metadata entries were classified
separately, not mistaken for API changes. `/v1/activity` is present. No compile,
install, download or unchanged suite rerun was needed/performed. Raw inventory
is retained. [Exact blocked target/provenance](docs/mcp-activity-regtest-target.json).

There is **no new REGTEST URL or known activity object to advertise**. The existing
legacy harness's30-minute lease/unbounded tempdir defaults were inspected but not
run; a future allowed target needs fixed storage/owner watchdog and<=20minute
lease before it can be offered. MCP RC2 ninth-tool actual-node acceptance remains
missing verification, separate from old eight-tool regtest evidence. Both readiness
flags remain **false** and shared Chipnet connection remains **unavailable**.

## Historical post-cleanup Chipnet quiet gate

The single newly authorized read-only gate ran60.164seconds with
31samples. **Disk admission passed every sample**: minimum
14,939,672,576bytes (13.914 GiB), above the
13.5625 GiB decoded-image+12 GiB reserve+64 MiB threshold. Final free space was
14.041 GiB. Pressure included **both1 and2**, so sustained normal
pressure failed despite a final normal sample. No active compiler was observed;
exact swap values and pressure counts are in [the gate record](docs/chipnet-after-ox-gate.json).

Coordinator was notified at probe start and end. **No repeat probe, actual
restoration, mount, native start or peer connection followed failure.** Actual
stage archive and old receipts remain intact; no actual restoration claim/image
or stage2 process claim exists. No product tests/builds were rerun. Storage
recovery is measured; quietness is not inferred from storage or the last sample.

Both readiness flags remain **false** and the owner connection **unavailable**.
The exact remaining gate is a separately authorized sustained normal-pressure
window, not additional disk reclamation for this bounded restore. Full sync
still requires>=25 GiB free AND concrete root review; it remains unapproved.

## Historical restore/new-inode support checkpoint

`scripts/cold_restore.py` now implements full archive/decoded SHA256+length checks,
exclusive private output, file/parent fsync and atomic no-replace publication of
NEW restoration receipts. Interrupted output/claims stay fail-closed without a
second image or automatic retry. `chipnet_resume.resume_plan` admits restored
identity only through verified custody/config/history and exact bytes, leaving
historical identity/receipts unchanged. Retained archives count toward allocation.

**14 restore +5 affected archive +8 affected resume checks passed** using small
owned synthetic files and mocked quiet/resource admission. Retained related test
allocation5,476,352bytes, below128 MiB. An explicit no-follow census was needed
because rejection fixtures intentionally contain symlinks; guards still reject
those links. [Exact reviewable evidence](docs/cold-restore-support.json).

The actual1.5 GiB stage remains archived: no actual restoration claim/image,
mount, native start, quiet probe or stage2 claim. Real restore/native resume are
**unverified**. Restore needs decoded-image space **plus>=12 GiB postrestore**,
64 MiB headroom and sustained normal-pressure/stable-swap gates. Last observed
9.29 GiB is historical; OX cleanup receipt is pending, not assumed recovered.
Full sync still needs>=25 GiB or assigned suitable storage and root review.
Both readiness flags remain **false** and the owner connection **unavailable**.

## Historical verified cold custody — no node window

Five cleanly detached owned native/process-test images were archived sequentially.
Every complete decompression matched original SHA256 and length, and archives plus
custody records/parents were fsynced before removing only the original encoded
image files. Original receipts/configuration/logs and runtime/source/audit files
remain intact. [Exact custody evidence](docs/cold-image-custody.json) and
[restoration/revalidation procedure](docs/cold-image-custody.md).

Original encoded allocation1,811,939,328bytes is now preserved in7,994,675 archive
body bytes (8,052,736bytes allocated including custody records). Owned net reclaim:
1,803,886,592bytes. Actual shared-host free space changed from8,356,028,416bytes
(7.78 GiB) to9,975,762,944bytes (9.29 GiB); other workloads affect this delta.
Still below12 GiB: no repeated quiet probe, restoration, mount, node or P2P.
One incomplete-exit smoke image was skipped; tiny metadata fixtures/manual quota
proof were excluded. No foreign cleanup or same-volume trash move occurred.

Five custody tests passed; eight resume refusal/budget checks passed after adding
an explicit cold-archive refusal. The historical image inode is unchanged in its
ledger. Original bytes are safe in verified private archives, but restoration and
explicit new-inode reconciliation remain **unimplemented/unverified**; no guard
bypass or automatic restoration/resume exists. The second process attempt remains
unconsumed. Both readiness flags stay **false**, owner connection **unavailable**.
Issuer Identity still requires real validating RPC, complete path discovery and
fresh verified checkpoint/tip/current authority; archival is not source readiness.

## Historical conditional resume resource gate

Root reviewed the prior clean stop and authorized one further bounded stage after
a sustained quiet preflight. The60.179-second observation failed **before any
mount, native start or peer connection**: pressure stayed at warning level2;
last free space4,750,098,432bytes (4.42 GiB), below the12 GiB entry floor and8 GiB
reserve. At that sample another8,134,803,456bytes (7.576 GiB) must become free,
plus normal pressure/stable swap throughout a fresh60-second window. Proposed
library-owner cleanup is not assumed completed or sufficient; no foreign cleanup,
threshold change or repeated launch was performed here.

Implemented checked resume of the same detached image with new private control
records. Prior1,570 receive bytes,783 upload bytes and4.196 seconds are deducted;
old image plus old/new outer allocation is counted once. Original receipts/claims
stay untouched. **8 focused resume tests and4 affected process-control checks
passed**. Actual image reattachment/native resume remains **unverified and blocked**;
these tests are not Chipnet acceptance. No new image, native/heavy build, credential
card or unchanged product-suite rerun. See [current resume evidence](docs/chipnet-resume-control.json).

Both readiness flags remain **false** and the owner connection **unavailable**.
The conditional second process attempt is unconsumed; there is no automatic
retry/resume. Full sync still needs>=25 GiB free or assigned suitable storage and
concrete root review. CashRelay's independently owned API recovery is unrelated
to this node lifecycle; this owner stopped no foreign runtime.

## Historical first bounded native Chipnet stage — 15 November 2026

**The single authorized stage stopped on host memory pressure; it did not produce
a usable Chipnet endpoint.** `testnetFunctionalReady=false`, `publicReleaseReady=false`.
See [exact control/evidence record](docs/chipnet-stage1-control.json) and
[operator lifecycle/limits](docs/owned-node-supervisor.md).

Root accepted the one authenticated im_uname attestation for this scope. Only the
inspected preview daemon was extracted into a new private runtime directory;
archive/member hashes, native version/help and system dependencies checked.
The old29.2.0 installation, OS trust/quarantine and default expiry/activation
policies were preserved. Calin's default-policy DSA rejection remains; no second
verified attestation, reproducibility or developer notarization is claimed.

Independent owner watchdog, exact process/cookie/listener ownership, exclusive
stop receipts, parent heartbeat fallback, fixed-capacity datadir and bounded
one-attempt peer relays are implemented. **20/20 targeted tests passed**, including
process-backed faults, actual ENOSPC/detach and two-stream receive limits. Native
no-peer regtest on a96 MiB image passed with separate native/watchdog exit0 and
clean owner-cookie stop/detach. A prior32 MiB native low-disk refusal was reconciled
and preserved; the low-disk policy was not bypassed.

Fresh stage preflight passed with14,008,975,360 free bytes, normal pressure and
stable swap/no observed heavy compiler. The4.196-second stage checked native
Chipnet genesis and default expiry, then pressure changed to2. The independent
watchdog closed peer relays and stopped the exact node via RPC: native PID26689
and watchdog26697 exited0; owned1536 MiB image detached without force and retained.
Final remote application receive1,570bytes/upload783bytes; owned allocation
1,610,686,464bytes and sampled RSS peak83,525,632bytes. TCP/IP/kernel overhead and
transient sampling overshoot are not hard measured bounds. A fully allocated image
is not downloaded-chain size or a usable full-sync capacity measurement.

Highest RPC-sampled height was0. Peers' announced332538 is untrusted, not a
canonical tip. No split checkpoint, ready txindex, representative CashTokens,
Blaze coverage, REST lease or consumer Chipnet acceptance was established.
The connection stays **unavailable**. The one-attempt claim is consumed: no automatic
retry/resume. Root must review this result and a quiet resource window before any
further scoped attempt; full retained sync additionally requires >=25 GiB free or
assigned suitable storage. A securely supplied ready operator source remains an
alternative; the existing credential card was not reopened.

Previous99-source/19-installed Node24 checks are historical and were not rerun.
The existing tarball is unchanged; the new Python operator tools live in the source
checkout and are not represented by its earlier installed-artifact evidence.

## Historical isolated OpenPGP audit — 15 November 2026

[Detailed audit](docs/chipnet-openpgp-audit.json) resolves the earlier missing-verifier
gap within the later explicit authorization. Exact OpenPGP.js6.3.1 was set up only
in a new owned diagnostic subdirectory, with pinned SHA512 package integrity and
a valid npm registry ECDSA metadata signature. No lifecycle script, global/system
install, user GPG/keychain/trust database or persistent default was changed.

**One authenticated preview checksum signature:** im_uname's actual retained
clear-signed message verifies at its creation time and current time, including the
exact archive hash/name. Full primary fingerprint
`BA578BC691D53253036D02C8A93E50646A20ED95` matches official developer records pinned
to two historical release commits on GitHub, distinct from the preview checksum
host. The current official GitLab key bundle matches the historical bundle. A
historical29.2.0 release signature by the same key also verifies and binds the
known stable ARM64 archive. The signature directly uses the primary key; no
signing subkey was substituted. The certificate is valid/unrevoked in available
material at both times and expires2030-12-31T20:00:00Z. The fingerprint keyserver
returned404 for this key; current revocation evidence is limited to the official
bundle, and unpublished revocations cannot be excluded.

**Calin's preview signature remains unverified:** the full key fingerprint is
corroborated in the same historical records, but unchanged OpenPGP.js default
policy rejects DSA. That rejection is retained, with no algorithm-policy override
or weaker-verifier fallback. It is not a claim of mathematical signature failure.
A current fingerprint-based key refresh yielded no revocation in the available
material; it does not bypass the policy rejection. This is not two verified signatures.

Authenticated checksums, historical identity binding, embedded/source build-ID
consistency and reproducible builds are separate claims. Reproducibility, trusted
macOS developer signing/notarization and runtime consensus behavior remain
unproven. Source still intends the2027 upgrade with the next expiry guard retained;
no BCHN file was extracted/executed/installed/replaced and no config/node/peer/sync
was started. Earlier archive/source/provenance artifacts are preserved. Product
tests were not rerun. Aggregate audit transfers/allocated files plus conservative
overhead stay within250 MiB and the10 GiB free-space floor was checked.

Root must review this bounded result before any further authorization. Existing
storage/load/watchdog/full-sync prerequisites remain. Owner connection stays
**unavailable**; `testnetFunctionalReady=false`, `publicReleaseReady=false`.


## Historical bounded preview artifact verification — 15 November 2026

[Exact provenance and artifact record](docs/chipnet-preview-provenance.json):
**archive integrity and embedded identity are consistent; signature authentication
is incomplete**. The official ARM64 unsigned29.2.1 archive is retained only in a
new owned diagnostic directory. SHA256
`e7f224e27b79f35887fda2900e2aae81c030f290f0fad82338e6061726ba7f15`
matches two available clear-signed checksum payloads and the build-result manifest.
Gzip CRC/full-stream checks passed; static ARM64 Mach-O inspection found
`v29.2.1-3e6827e95`, consistent with the manifest and GitLab full commit
`3e6827e95c7a17497e09ac15556debd116dea1d0`. No files were extracted or executed.
A versioned dylib symlink was inspected as metadata and never followed.

Pinned source retains expiry guards and uses the next Chipnet deadline,
2027-11-15T12:00:00Z, alongside the intended faster-block activation. This is
static intent/consistency evidence, **not runtime consensus proof**. Existing29.2.0
is unchanged and remains expired for current Chipnet. The preview distribution
is labeled unsigned; a Mach-O signature load command alone supplies no developer
trust/notarization. No OpenPGP verifier is available in checked installed tooling.
The two signatures and claimed signer fingerprints are retained but cryptographic
verification and independently authenticated key bindings remain missing.
Same-origin matching digests are not authentication or reproducible-build proof.

The archive is27,745,526 bytes. Counted HTTPS bodies plus retained disk allocation
and a16 MiB protocol/report allowance stay below the250 MiB combined budget;
free space at completion was about13.23 GiB, above the10 GiB floor. Wire protocol
overhead was not independently captured. Exact counts/files/URLs/hashes and the
retained diagnostic record are in the provenance JSON. No runtime/verifier was
installed, no active config/binary was replaced, and no daemon/peer/sync, deletion,
move, purchase or product-test rerun occurred. Collection stops at the explicit
OpenPGP/key-authentication gap for root review. Hosting/resource/watchdog gates
still apply. Owner connection remains **unavailable** and both readiness flags false.


## Read-only local hosting assessment — 15 November 2026

[Machine-readable feasibility](docs/chipnet-hosting-feasibility.json) records the
current hardware/resource observations, primary sources and conditional plan.
**Do not start the installed BCHN29.2.0 on current Chipnet:** official tagged code
expires its default Chipnet RPC at **2026-11-15T12:00:00Z**, now passed. The guard
is wall-clock based, independent of this node's sync progress. No `expire=0`,
RPC-expiry, activation-time or clock override is permitted. Regtest evidence below
is historical support, never current Chipnet-version compatibility.

The maintainers' 14 November notice directs Chipnet operators to an upgrade2027
preview (ARM64 macOS unsigned archive listed); no replacement was downloaded,
installed, signature-verified or executed here. Latest general stable metadata
still names 29.2.0, which does not satisfy the current Chipnet target. A future
build must be tied to verified current rules, commit and maintainer attestations.

Latest snapshot: about 13.63 GiB free, 48 GiB physical RAM, substantial compression
and about11.6 GiB swap used, with foreign builds/emulators active. A public operator
webpage reports4,367,750,091 bytes of retained blocks/undo at 332444; this excludes
chainstate/txindex/Blaze and is neither an assigned RPC source nor independent
chain proof. Total working allocation is uncertain (planning roughly6.04–14.75 GiB).
The conservative full-sync gate is25 GiB free:16 GiB owned allocation plus8 GiB
system reserve and1 GiB stopping margin. This is policy, not a measured physical
minimum. A separate first2 GiB/30-minute measurement stage could fit a12 GiB
start gate, but remains blocked by the expired binary, contention, missing watchdog
and the read-only scope; it cannot promise a synchronized target. Candidate paths,
ports53315–53319, staged receive/time ceilings and clean-stop rules are documented
without creating/binding anything. Polling thresholds are not atomic disk quotas.

No node execution, peer connection, chain/binary download, runtime install/update,
deletion, purchase, relocation, credential card, test/build rerun or sibling edit.
CashRelay's now-disabled old peer is historical evidence only; no fresh proof is
claimed from it. `docs/chipnet-connection.json` remains **unavailable**; both
readiness flags remain false. Earlier99-source/19-installed artifact evidence is
preserved without rerunning it.


Owner: this existing visible T3 thread; direct execution, no delegates/new threads.
Branch: `feature/cashtokens-indexer`. Root backend only. Preserve all dirty work;
sibling repositories and coordinator files are read-only.

## Active objective — full functional Chipnet delivery

`testnetFunctionalReady=false`; `publicReleaseReady=false`.

The user requires the stated functional scope on **actual Chipnet**, including
shared consumer acceptance. Historical MVP checkpoints below are retained evidence,
not completion gates. Cosmetic/public-launch-only infrastructure is secondary.
No protected-ref changes, publication/deployment, mainnet or existing-user funds.

### Current implemented and tested checkpoint — 15 November 2026

- Original15-query workload paths, mempool transaction views, native enriched
  prevouts/fallback, bounded canonical block projections, exact token/holder/NFT
  state and category-filtered genesis/reserve/supply are implemented.
- Global `GET /v1/activity` is actual retained movement history, including mixed
  categories and input-only burns. Exact issued/burned/net integer strings,
  deterministic paging, `snapshot_hash`409 and legacy/partial gross fields null.
  Metadata-only authchain events are excluded explicitly. See `docs/activity-api-v1.md`.
- Category/non-category metadata identities share compact nodes/edges. Configured
  unpublished roots and explicit bounded historical authbase resolution work;
  complete cached paths are watched and invalidated on reorg. Exact supplied BCMR
  bytes are hash/schema-validated with a bounded cache; URI fetching, Nostr and
  issuer certification remain consumer/verifier responsibilities.
- Recovery: atomic schema3→4 and supplementary activity/identity migrations,
  online WAL-inclusive backup, integrity/FK checks, no-overwrite restore, private
  writer claim/dead-owner recovery, finite undo and deep-reorg refusal.
- Lifecycle: seven startup/shutdown/IBD/stale/storage/crash profiles, cancellable
  RPC, global concurrency/body budgets and pre-commit free-space guard.
- Optional loopback read proxy includes `getblock`, `getblockhash`, `gettxout`,
  `getrawtransaction` and **`getindexinfo`**. Shared acceptance requires unpruned,
  IBD-complete history and `txindex.synced=true`/`best_block_height` equal to the
  measured canonical tip. Extraction `/readyz` alone makes no archive promise.
  Separate historical source configuration is independently verified.
- Optional test-submit proxy uses separate upstream credentials, private capability,
  exact bytes/txid/outpoints/expiry and independently calculated fee limits.
  Durable SQLite journal records before send; ambiguous responses and replay
  reconcile without automatic resend. No wallet/signing/admin RPC; mainnet forbidden.
- New real-BCHN run passed after the txindex addition: official native BCHN29.2.0,
  zero-peer owned regtest, actual consensus CashTokens >2^53/all3 capabilities,
  resolved prevouts, mempool, committed metadata, input-only burn, approved test
  submission, reorg and backup/restore catch-up. `getindexinfo` reported synced
  txindex103 and the read proxy returned it. **This is regtest, never Chipnet.**
- Current full-source suite: **99/99 passed, zero failures/skips**, including native
  BCHN, on Node24.18.0. Typecheck/build passed. Actual packaged-runtime19/19 passed after extracting the tarball to a second
  empty directory and installing production dependencies only, with no rebuild or
  tsx/TypeScript present. Compiled test support was injected separately; runtime
  imports/child entrypoints came from the extracted artifact. Reports preserve
  immutable prior copies under `.build/reports/archive/` and runtime source hashes.
- Synthetic2,000-block SQLite churn/32-block undo retained33 outputs,2,000 movement
  rows and one live UTXO: DB1,064,960 bytes, WAL high-water4,214,792 bytes, test-process
  RSS219,463,680 bytes. This is not chain capacity, BCHN disk or a VPS sizing proof.
- MCP independently accepted all8 tools/2 resources/cancellation using its clean
  exact Node24.0.0 consumer on our process-backed regtest target. Its final reads
  completed; the owned53314 lease, indexer/node and temporary directory were stopped.
  No supporting lease remains advertised. Explorer reports direct activity API
  integration/component checks; its local457 checkpoint is consumer-reported,
  not an indexer-run/live-Chipnet result. CashCart's83 local tests are also sibling evidence.
- Compose config validated. Docker runtime/build remains **unverified** because the
  configured engine socket is unavailable; no daemon or foreign services started.

### Genuine shared prerequisite

`docs/chipnet-connection.json` is authoritative and **unavailable**: no live REST
URL, no BCHN read route, no measured txindex/genesis/tip/coverage or real samples.
Official BCHN29.2.0 genesis and post-fork115252 pins are enforced. Independent
Electrum observations are recorded separately; they provide no BCHN/txindex access.

The sole secure RPC URL card timed out without input. Per coordinator, **no duplicate
card/node/sync/relocation** is opened. Required operator input is a retained,
unpruned, synchronized Chipnet BCHN read source including `getindexinfo`, ready
historical txindex and resolvable prevouts. Test submissions need separate privileges
and exact-byte approvals for dedicated test identities/coins. Read roles are never
elevated. No live endpoint is invented or relabeled from regtest.

Next source-dependent action: verify genesis/checkpoint, tip age/peers, unpruned
history and txindex catch-up; bounded representative ingestion; run
`npm run accept:chipnet`; publish measured owned REST/read target for siblings.
See `docs/testnet-operations.md` for exact commands, policy and recovery.

Milestone/blocker handoff sent in English to the existing coordinator thread on
15 November 2026. No completed consumer thread was reopened and no duplicate
source prompt or node was created.

## Exact installed artifact and evidence

- Artifact: `/Users/salmshmakh/.t3/projects/blaze/.build/artifacts/blaze-indexer-0.1.0-1794743746086.tgz`.
- SHA256: `edb1421d41d8d593155b79b86b23e76c7d7a277b80295fb6a09ad2ba1f9b51e3`.
- Tested runtime source SHA256: `9ce3f2cd606187b5649532010b491e67fdd2e814a38f76b01cf80b3a3f5a5f8d`.
- Secret-free machine evidence: `docs/indexer-functional-evidence.json`.
- Stable latest reports: `.build/reports/regtest-acceptance.json`,
  `.build/reports/clean-install.json`, `.build/reports/retention-check.json`.
  Immutable dated copies are retained under `.build/reports/archive/`.
- Latest clean artifact command: `PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run check:clean`.

## Reviewable file ownership and continuity

Current manifest: `docs/indexer-change-manifest.md`. No sibling/coordinator source,
branch protections, device assignments or application ports were changed. Native
node tests use a new owned no-peer temporary directory and ephemeral loopback
ports, then clean only their own processes/files. Official binary is ignored under
`.build/tooling/`; no full chain was downloaded. No local product-completion claim.

## Historical local MVP checkpoint — 2026-11-15

Local indexer MVP implementation and local verification are complete; real-chain
acceptance is blocked by absent BCHN configuration/data. The historical progress
entries below are retained as checkpoints, not descriptions of current unfinished
code. Project status/handoff and new documentation are English.

- Final supported-runtime check on **Node 24.18.0**: 74/74 tests passed with
  `node --import tsx --test --test-concurrency=1 test/*.test.ts`.
- Compiled production entrypoint: 3/3 HTTP lifecycle profiles passed on Node 24
  with `BLAZE_TEST_BUILT=true node --import tsx --test test/main.test.ts` after build.
- `npm run typecheck` and `npm run build` passed. Earlier full suite on Node
  v26.5.0 also passed 74 tests; Node 24 is the final supported-runtime evidence.
- `npm run test:built` is now the convenient build + compiled-server smoke command.
- Initial Node-24 concurrent checks had two readiness-deadline failures. All three
  isolated profiles then passed. The lifecycle test now allows a bounded 30 seconds
  and reports sanitized process-state diagnostics; final serialized suite passed.
  Other builds were active on the host. No production startup-latency conclusion
  is drawn, and no other process was stopped.
- Implemented: native enriched/fallback BCH reads, exact homepage size, selected
  fee-only statistics, bounded projection reuse with canonical rechecks; schema-4
  binary keys, atomic v3 migration and finite undo; confirmed metadata-only/CTOR/
  merge/burn category authchains with explicit partial coverage.
- Stable integration artifacts: `docs/authchain-api-v1.md` and
  `docs/authchain-api-v1.schema.json`, validated by the API and schema drift test.
  Regenerate with `npm run contracts:export`.
- Confirmed without printing configuration values: no `BCH_RPC_URL` environment
  setting, no `.env`, and no default `data/cashtokens.sqlite` are present. There is
  **no live indexed height** to publish. Fixture heights are not live evidence.
- Remaining external acceptance: independent live-BCHN verification, actual storage/
  WAL and sustained performance measurements, and explorer/verifier integration.
  Arbitrary non-category authbases, mempool overlays and remote metadata content/
  schema verification remain outside this indexer's MVP. Discovery hints are not
  an issuer-ownership certificate; the separate verifier owns that responsibility.
- No installs, commits, pushes, deployment, chain download or financial actions.
  Existing branch/worktree and all pre-existing dirty work are preserved.

## 2026-11-15 — resumed implementation

- Preserved all existing dirty/untracked files. No existing WORK-STATUS was present.
- Inspected processes: no running indexer/build/test process for this repository before checks.
- Baseline verified now: `npm test` 45/45 passed; `npm run typecheck` passed on Node v26.5.0. Dependencies already present; no install performed.
- In progress: native enriched BCH reads, exact homepage block sizes, bounded block projection caching; schema migration with binary identifiers and finite spent-output undo retention; narrow confirmed authchain tracking including metadata-only spends.
- Next: acceptance tests against the original 15-operation inventory, integration contract, full verification and updated handoff.
- External limits: no configured live BCHN dataset has been validated. Fixtures cannot establish production performance, complete mainnet state, or VPS size. No deployment or financial transactions authorized/performed.

## Integration checkpoint — authchain discovery v1

- Implemented route: `GET /v1/tokens/:category/authchain?limit=100&offset=0`.
- Contract: `docs/authchain-api-v1.md`. Envelope includes `network`, `confirmed_only`, `indexed_height`; data includes fork hash in `coverage.indexed_tip` and explicit `coverage.status`.
- Any nonzero start or schema-3 migration reports `incomplete`. An absent observed head reports `status: incomplete`; no ownership assertion is fabricated.
- Current authority remains the independent verifier's job using its own BCHN and current output 0. No Nostr implementation in this indexer.
- No live node/database is configured in this checkout, so there is **no current live indexed_height to report**. Fixtures exercise indexed heights only. New integration code and schema are still under test; final evidence will follow.

## Historical file manifest for the first implementation checkpoint

The repository was already largely untracked at resume. This list identifies
files created/edited by this execution; it does not imply ownership of all files
shown by `git status`.

- Runtime: `src/api.ts`, `src/bch.ts`, `src/config.ts`, `src/main.ts`, `src/storage.ts`, `src/store.ts`.
- New implementation: `src/authchain.ts`, `src/authchain-contract.ts`, `src/migration.ts`.
- Tests: `test/authchain.test.ts`, `test/bch.test.ts`, `test/explorer-acceptance.test.ts`, `test/main.test.ts`, `test/retention.test.ts`, `test/storage.test.ts`, `test/store.test.ts`.
- Configuration/tooling: `.env.example`, `package.json`, `scripts/export-contracts.ts`.
- Contracts/storage docs: `docs/authchain-api-v1.md`, `docs/authchain-api-v1.schema.json`, `docs/storage-v4.md`, `docs/explorer-minimum-backend-analysis.md`, `docs/storage-and-extraction-plan.md`.
- Project documentation: `README.md`, `WORK-STATUS.md`, `PROJECT-HANDOFF.md`.

No sibling repository, coordinator document, branch protection hook, device,
assigned application port or other process was modified. Tests use owned temporary
databases and ephemeral loopback ports, then remove/stop only their own resources.
