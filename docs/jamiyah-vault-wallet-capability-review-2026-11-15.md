# MemberVaultV4 wallet capability — coordinator review

Status: concrete interface proposal; not an implemented or approved wallet method.
No signing, native adoption, transaction submission or library extension is approved
by this review. Current XO generic transaction preparation rejects these inputs.

Reviewed input: `projects/jamiyah/evidence/vault-wallet-v4-capability.json`, SHA256
`4e2cf0f4a8dde281b4b6ebdb11f6be3c08f4fe5521fd77939b39129556f954b1`.
The preparation checkpoint has thirteen verified file hashes and nine owner-run
tests, including one SIGKILL. These are unsafe public fixtures, not live accounts.

## Checks performed

- Independently checked all three transaction-signing serialization digests in
  the two fixture requests using double SHA256 over decoded bytes.
- Independently derived all three parent transaction IDs from raw parent bytes;
  each matches its requested outpoint.
- Checked the fixed contract source, constructor and bounded credit/withdraw
  shapes. This is an owner vault with a cooldown, not integrated family recovery,
  majority governance, rotating savings or a dollar-denominated daily allowance.
- Verified the thirteen-file preparation manifest. No signatures, wallet calls,
  network requests or repeated project tests were performed for this review.

## Addenda required before wallet implementation approval

1. **Compiled template identity.** Supply the exact compiler/version, immutable
   compiled artifact and ABI hashes, and deterministic constructor encoding.
   A wallet must instantiate its own pinned template and match redeem/locking
   bytecode; a caller-supplied source hash and redeem script are insufficient.
   Preserve the current fixture and publish an additive profile descriptor.
2. **Hash encodings.** Define each binding hash's exact bytes/canonicalization.
   In the current request, `rawParentHash` is SHA256 of the lowercase hex text,
   whereas the Bitcoin transaction ID is reversed double SHA256 of decoded raw
   bytes. Signing-message hashes are double SHA256 of decoded serializations.
   These different domains must not be conflated by an independent wallet.
3. **Request lifecycle and authenticated channel.** Define peer/origin/session,
   selected account/network, request-ID correlation, approval deadline,
   cancellation/foreground/disconnect and duplicate/unknown-result handling.
   The current payload has no explicit deadline/cancellation envelope. This is
   a missing wallet/channel agreement, not proof the local builder is a live
   signer. BCH signatures do not authenticate the application's echoed hashes.
4. **Persistence and timing.** Preserve the original template, witness, signed
   bytes and reservations across post-signature ambiguity. Recheck authority,
   cancellation/expiry and fresh canonical source facts before returning a
   result. An application deadline is not an upper mining-time expiry. No
   automatic relay, re-signing or release follows an expired/unknown request.
5. **Independent source and scope.** Wallet verification must reconstruct parent
   transactions, covenant identity and current maturity from its agreed source;
   application provenance alone is not validation. Ordinary canonical advance,
   changed account state and a reorg require distinct handling without mutating
   approved economics. The NFT preview policy excludes covenants/time locks and
   cannot authorize this separate capability. Real source assignment, setup
   consent and representative current-node/native acceptance remain missing.

Further work should preserve the frozen source/evidence and close these exact
interface gaps. Do not add a generic covenant signer or present this subset as
the full Jamiyah family product. Testnet and public-release readiness remain false.
