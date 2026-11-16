# Pinned preview REGTEST maturity audit — source only

Commit: `3e6827e95c7a17497e09ac15556debd116dea1d0`. No native executable,
RPC, resource gate, image, download or build was run for this audit. The existing
18-check bounded-wrapper cohort is historical evidence, not rerun here. Six new
pure/mock profile checks passed; worker syntax parsing passed without execution.

## Exact contextual rules

Pinned `src/consensus/consensus.h` defines legacy target600 ticks, upgrade2027
 target60 ticks and `kCoinbaseMaturityTicks=100*600=60000`. Pinned
`src/consensus/tx_verify.cpp:219` maps each coin's height to ticks and rejects a
coinbase when `spendTicks - coinTicks < 60000`. Thus the rule is not an unconditional
100-block depth: it corresponds to100 legacy600-tick intervals, or1000 activated
60-tick intervals, with the actual piecewise schedule used across activation.
`validation.cpp:1260` constructs that schedule from the activation block;
`:3555` advances blocks by the previous block's next tick delta.

Height-based BIP68 also maps the coin height to ticks, scales the raw relative
lock value by600, subtracts1 for the failure threshold and compares against block
ticks. Time-based BIP68 continues using previous-block MTP and512-second units.
A sequence with its disable flag set is not evaluated as a relative lock. This
is contextual source behavior, not a new interpreter implementation or runtime
consensus certification.

The retained pinned `chainparams.cpp` is misleadingly named
`.build/diagnostics/chipnet-preview-20261115T122412Z-9736ab6b/preview-activation-gitlab.cpp`.
Its `CRegTestParams` sets upgrade2027 MTP1810382400 (2027-05-15T12:00Z),
upgrade2028/default expiry1842004800 (2028-05-15T12:00Z), CashTokens upgrade9
height0 and CSV height576. Chipnet differs: upgrade2027 MTP1794744000
(2026-11-15T12:00Z), next expiry1826280000. Activation uses **previous-block MTP**,
not an address prefix, current tip height or wall-clock comparison alone.

The library's `chainparams.cpp` (SHA160f0b...) is its stable checkpoint source;
it must not be mislabeled as the preview file. The library's commit-pinned
consensus/transaction/validation bodies and retained compare prove the tick rule;
our retained preview chainparams provides the exact preview network defaults.
Existing no-peer preview smoke metadata independently records the same regtest
600/600 target intervals, activation1810382400 and expiry1842004800. That smoke
was at height0; it is **not** a maturity spend or new acceptance execution.

## Finding and bounded correction

The stored WSS MTP1794772246 is after **Chipnet's** November2026 activation but
before **regtest's** May2027 default. It does not prove the default fresh-regtest
101-block fixture would fail in the observed pre2027 context. There is no blanket
claim that the preview always requires1000 mined blocks. The actual unsupported
assumption was mining101 and asserting104 without checking source/epoch/native
tick facts; it could fail once the fresh chain transitions to60-tick intervals.

The new pure `preview-regtest-profile.mjs` policy is deliberately narrow:

- Exact pinned source/version and fresh regtest genesis only. Future native
  chain info must expose600/600 spacing, matching block ticks, inactive2027,
  default activation1810382400 and expiry1842004800.
- Refuse a post2027 or crossing **prospective mining lease horizon** before wallet
  creation or mining. The wall-clock horizon is a conservative additional refusal,
  never a substitute for the native MTP/target/tick checks. Unknown profiles fail
  with a precise `PreviewProfileError` code.
- Pre-rule funding remains `ceil(60000/600)+1=101` blocks. Mining is capped at104
  total (101 funding +parent confirmation +issuance confirmation +burn confirmation).
  Every generation checks native state before/after; no auto-extension or retry.
- Before first wallet funding, require native101-block tick state and a native
  block1 coinbase UTXO with matching confirmations. Prospective spend tick depth
  must cover60000; the native wallet/consensus still decide spend acceptance.
- Genesis/burn raw transactions must have locktime0 and the BIP68 disable flag
  set on every input; no implicit height-relative-lock assumption is accepted.
  Parent funding remains a native-wallet transaction, subject to native checks.

Post-rule funding is explicitly **unsupported within this104-block/96MiB/finite-
lease fixture**, rather than silently generating1001 blocks, changing activation,
setting mocktime, changing expiry or ignoring coinbase checks. Existing resource,
lease, disk/RSS/heartbeat/ownership constraints remain unchanged. The historical
runner and47 compiled runtime API bytes are untouched.

## Reproduction and limits

```sh
node --test test/preview-regtest-profile.test.mjs
node --check scripts/bounded-regtest-worker.mjs
```

Tests are pure mocked native facts: pre-rule funding/maturity, post-rule refusal,
Chipnet-vs-regtest activation separation, crossing horizon, unknown source/version/
expiry/tick/reused-chain rejection, mining cap/noninteger refusal. They perform no
mining, source CLI execution or network requests. Exact file hashes and source
anchors: [audit record](preview-regtest-maturity-audit.json).

Future actual execution must independently observe all profile fields and write
`fixture-source-profile.json` before funding. No native maturity fact, current
canonical chain, validating endpoint, generic2027 VM compatibility or live
transaction success is claimed now. WSS context is server/header evidence only;
both readiness flags remain false.
