# Owned BCHN diagnostic supervisor

These macOS operator tools run from the source checkout. They are separate from
the Node24 indexer and are **not included in the previously tested production
tarball**. Python uses only its standard library and the host's existing
`ps`, `lsof`, `sysctl`, `vm_stat` and `hdiutil`; no global installation is needed.
They do not manage any existing node or automatically restart a stopped process.

The owner result is [stage1-control](chipnet-stage1-control.json). The public
connection contract remains [unavailable](chipnet-connection.json).

## Recorded result

On 15 November 2026 the accepted preview `v29.2.1-3e6827e95` ran from a new private
runtime directory. Only the inspected `bin/bitcoind` member was extracted, with
archive/member hashes checked. System dylibs were sufficient. Strict ad-hoc
codesign validation passed; trusted developer signing, notarization and
reproducibility were not established. The old29.2.0 installation, quarantine,
OS trust settings and expiry/activation defaults were preserved.

The no-peer native regtest smoke on a96 MiB fixed filesystem completed in2.283s:
native and separate watchdog exit0, owner-cookie RPC stop, image detached
without force and retained. Allocated owned bytes were100,720,640. The earlier
32 MiB attempt hit BCHN's native low-disk refusal; its completed shutdown was
reconciled and the image retained. The launcher now records early exits in a
`finally` path. The native low-disk policy was not bypassed.

Twenty targeted tests passed: owned process-backed stop/fault cases,
PID/UID/birth/executable/argv/datadir refusal, ambiguous-stop restraint,
expiry/RPC/parent loss, monotonic heartbeat/deadline, real filesystem ENOSPC and
a shared cap across two loopback receive streams plus a separate upload cap.
These support the controls; they are not synchronized Chipnet product evidence.

One authorized Chipnet stage started at13:55:15Z after fresh entry gates passed.
The private native RPC confirmed the configured chain, expected genesis and
expiry1826280000 (15 November 2027 at12:00Z), with history retained and txindex
enabled. The watchdog observed host memory pressure change from1 to2, closed
its relays and stopped the exact owned node with cookie RPC. Native PID26689 and
watchdog26697 exited0; the image detached without force. Total elapsed4.196s;
retained image plus outer records1,610,686,464bytes, sampled RSS peak83,525,632bytes,
remote application receive1,570bytes and upload783bytes. Shared-host pressure
was observed, not attributed to a particular foreign process.

RPC's highest sampled block was0. Peers announced332538, but this is **not a
verified canonical tip**. The split checkpoint was not reached. No representative
CashTokens activity, synchronized txindex, Blaze database or REST target exists.
The attempt claim is consumed; no automatic retry/resume or full sync is allowed.

## Ownership and stopping

Each run is a new0700 directory. Exclusive0600 records bind PID, UID, birth,
full argv, kernel-mapped executable, datadir, native private cookie and loopback
RPC port. RPC checks the exact process's listener, rejects redirects and ignores
HTTP proxy environment variables. Cookies are never printed or shared.

The guardian is a separate process. Resource/probe batches have bounded deadlines
and polling at most2s (configured1s for stage1). The parent also checks monotonic
counter progress and has an independent stop path if the guardian exits or its
heartbeat stalls. Either side must acquire the exclusive stop claim. It attempts
owner-cookie `stop` once; ambiguous RPC is reconciled before a fresh exact-owner
SIGTERM fallback. No SIGKILL, automatic restart, foreign signal, broad cleanup or
forced unmount is implemented. An ambiguous receipt blocks progression.

## Allocation and receive controls

`bounded_store.py` creates a new fixed-capacity image; no resize/overwrite exists.
The1536 MiB stage image contains the native datadir and temporary directory.
The owner checks inode/size/UID/mode, mount device and filesystem capacity.
Detach additionally checks the current image/device/mount association, and only
occurs after both native and watchdog exits are confirmed. Data stays in the
retained image. Do not delete or relocate it as routine cleanup.

Outer native stdout is drained with at most8 MiB retained and a stop marker;
counters are bounded to1 MiB and observations to the last16. Native core dumps
are disabled. The image is counted once rather than counting both its backing
allocation and mounted contents. A fully allocated image is not downloaded-chain
size; this attempt did not measure a useful retained-chain footprint or sync rate.

`peer_byte_gate.py` opens at most two owned loopback listeners, one attempt per
resolved official-seed target and no reconnection. Native automatic peers, DNS
seeding, inbound listeners, discovery, UPnP and NAT-PMP are disabled. After exact
native identity/genesis/expiry checks, the parent can issue `addnode onetry` only
to the live owned relay ports. No other peer activation route is exposed.

A shared lock caps aggregate remote **application bytes read** at1792 MiB and
upload separately at64 MiB. No bytes beyond the read cap are forwarded. Kernel
receive buffers are requested at64 KiB; outstanding kernel traffic, TCP/IP/TLS
headers and retransmissions are outside application counters. The256 MiB receive
headroom is not a packet-level quota. `maxuploadtarget`, dbcache, par and connection
settings are conservative knobs, not hard download/RSS quotas.

Free-space, memory-pressure, RSS and swap thresholds are sampled and can overshoot
between observations or during shutdown. The observed stop was prompt; it does
not prove hard scheduling/RSS/physical-wire bounds under all failures. Record any
future overshoot rather than claim a guarantee or force-kill a stuck process.

## Entry gates and reproduction

The recorded tests can be reproduced with:

```sh
npm run test:node-supervisor
```

This retains a new test directory and a32 MiB filesystem-exhaustion image per run;
do not rerun it as an idle status check. Tests use self-expiring owned fixtures,
not user nodes or external peers. A no-peer native smoke is available as:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/owned_node_smoke.py --binary /absolute/owned/bin/bitcoind --fixed-store
```

Inspect current processes/storage and existing receipts first. The launcher pins
the accepted binary digest and refuses insufficient reserve. No user config,
wallet, mining or broadcast is used. Its native stage is bounded below5 minutes
and256 MiB; control-test images are retained separately.

The measured invocation, **not an instruction or authorization to repeat it**, was:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/owned_node_measure.py --binary /absolute/owned/bin/bitcoind
```

The durable `.build/runtime/chipnet-stage1-authorization-20261115.json` prevents a
second attempt. Never remove/change that claim to resume. First-stage gates were
at least12 GiB free, normal memory pressure, stable swap across two samples,
at least4 GiB reclaimable-page estimate, no observed active heavy compiler,
no existing native node, compatible pinned runtime, unused loopback ports and
tested controls. This estimate is not a promise of immediately available RAM.

Stopping thresholds: free below9 GiB (8 GiB reserve plus headroom), RSS above2 GiB,
swap growth above512 MiB, memory-pressure warning, ownership/expiry/RPC failure,
no block progress600s, byte/allocation limits or checkpoint115252. Native
`stopatheight=115252` is an additional boundary. The deadline starts during setup
and leaves stop margin within the30-minute stage. A second stage or extension
requires root review; full retained sync additionally needs at least25 GiB free
or suitable assigned storage. Do not quiet the machine by stopping siblings.

## Conditional retained-image continuation

The later root continuation reviews the first clean pressure-stop and conditionally
authorizes one further bounded stage. `--resume-from` accepts only the reviewed
`chipnet-stage1-1649e90f` origin. It validates private image inode/size, clean prior
native/watchdog exits and detach, cumulative counters and retained allocation;
it creates new control records and reattaches the original image at its original
mountpoint. It does not copy/resize the image or overwrite prior receipts.

The launcher now samples resources throughout at least60 seconds before claiming
the separate one-use stage2 authorization. Every sample must meet the12 GiB,
normal-pressure, stable-swap/no-heavy-build gates. It rechecks12 GiB before resume
peer activation. A failed quiet gate starts no mount/node/peer and does not
consume the process attempt. Do not automatically repeat failed gate attempts.

Prior1570 receive bytes,783 upload bytes and4.196 seconds are deducted from the
same conservative budgets. Original image/outer records plus new control files
are counted once. No cumulative allocation headroom means refusal before mount.
The guardian's delivered/native receive counters carry the prior receive offset;
the relay can read only the remaining receive/upload budgets. Stop rules remain
unchanged. No full sync is authorized by this continuation.

Read-only validation of the actual preserved image plan and eight focused control
tests passed; four affected process-control regression checks passed separately.
The actual HFS reattachment/native resume path remains unverified: a60.179-second
host observation failed with4.42 GiB free and pressure2. See
[resume-control](chipnet-resume-control.json). No second process attempt occurred.
Library-owner cleanup is neither performed nor assumed successful here. Even its
proposed3.83 GiB upper bound would not alone close the observed7.576 GiB deficit.

The focused, lightweight resume checks use no native daemon or mounted image:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s test -p 'test_chipnet_resume.py' -v
```

A future execution after actual resource recovery must use the existing
`owned_node_measure.py --binary /absolute/owned/bin/bitcoind --resume-from
/absolute/owned/chipnet-stage1-1649e90f` route. This description does not mean the
currently failed gates have passed or authorize bypassing them.
