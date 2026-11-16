# Explorer migration artifact

The patch contains the complete change to salemkode/explorer, based on commit 87af1dfe67d918df9c29c7996e9be11b4b5183e4. It includes new files, removed GraphQL/Apollo code, the authoritative pnpm lockfile, and removal of stale npm/Bun lockfiles.

The edited checkout is at /Users/salmshmakh/.t3/projects/blaze/.build/explorer, branch feature/lightweight-cashtokens. No commits, pushes, merges, or deployments were performed.

Apply explorer.patch to a clean task branch at the base commit using git apply --check followed by git apply. Then run pnpm install --frozen-lockfile, pnpm test, pnpm lint:type, and pnpm generate.

The patch was checked in reverse against the edited checkout. Five provider/amount/hash tests, typecheck, and static generation pass. Review on a newer checkout for conflicts before applying.

Use explorer.env.example for public API origins. The backend requires BCHN RPC with completed txindex=1 for historical transaction pages. Mainnet/chipnet need separate API services. Electrum handles address history; chipnet needs its own configured provider.

There is no Chaingraph fallback. Public BCMR data is labeled as registry metadata; the Doctor verifies supplied content without asserting on-chain authorization. Token data is confirmed-only. Browser interaction and live-mainnet acceptance have not been run.
