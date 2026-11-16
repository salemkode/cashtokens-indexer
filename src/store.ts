import { setupActivity, readActivity, activityPage } from './activity.js';
import { setupResolutions, watchResolutions, readResolution } from './authchain-resolution.js';
import { indexIdentities, readIdentity, setupIdentities } from './identities.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { z } from 'zod';
import { storedHex, binary, migrateBinary } from './migration.js';
import { indexAuthchains, readAuthchain, setupAuthchains } from './authchain.js';
import { hash, hex, IndexerError, network, outputFilter, page, rpcBlock } from './model.js';

const tipRow = z.object({ height: z.number(), hash: storedHex, previousHash: storedHex.nullable() });
const outputRow = z.object({
  txid: storedHex, vout: z.number(), category: storedHex, amount: z.string(),
  capability: z.enum(['none', 'mutable', 'minting']).nullable(), commitment: storedHex.nullable(),
  script: storedHex, satoshis: z.string(),
});
const summaryRow = z.object({
  category: storedHex, genesis_txid: storedHex, genesis_height: z.number(),
  fungible_supply: z.string(), nft_count: z.number(), minting_count: z.number(), utxo_count: z.number(),
});
const holderRow = z.object({ locking_bytecode: storedHex, fungible_token_amount: z.string(), nft_count: z.number() });
const historyRow = z.object({
  block_hash: storedHex, txid: storedHex, height: z.number(), timestamp: z.number(), output_satoshis: z.string(),
  fungible_delta: z.string(), nft_delta: z.number(),
});
function bytea(value: string) { return `\\x${value}`; }
const live = 'o.spent_by IS NULL AND o.unspendable = 0';

function addLiveOutput(row: 'NEW' | 'OLD') {
  return `
    INSERT INTO category_totals(category, supply, nft_count, minting_count, utxo_count)
    VALUES (${row}.category, ${row}.amount, ${row}.capability IS NOT NULL,
      ${row}.capability IS 'minting', 1)
    ON CONFLICT(category) DO UPDATE SET
      supply = token_add(supply, excluded.supply),
      nft_count = nft_count + excluded.nft_count,
      minting_count = minting_count + excluded.minting_count,
      utxo_count = utxo_count + 1;
    INSERT INTO holder_balances(category, script, amount, nft_count, utxo_count)
    VALUES (${row}.category, ${row}.script, ${row}.amount, ${row}.capability IS NOT NULL, 1)
    ON CONFLICT(category, script) DO UPDATE SET
      amount = token_add(amount, excluded.amount),
      nft_count = nft_count + excluded.nft_count,
      utxo_count = utxo_count + 1;
  `;
}

function removeLiveOutput(row: 'OLD') {
  return `
    UPDATE category_totals SET supply = token_add(supply, '-' || ${row}.amount),
      nft_count = nft_count - (${row}.capability IS NOT NULL),
      minting_count = minting_count - (${row}.capability IS 'minting'),
      utxo_count = utxo_count - 1 WHERE category = ${row}.category;
    UPDATE holder_balances SET amount = token_add(amount, '-' || ${row}.amount),
      nft_count = nft_count - (${row}.capability IS NOT NULL), utxo_count = utxo_count - 1
      WHERE category = ${row}.category AND script = ${row}.script;
    DELETE FROM holder_balances WHERE category = ${row}.category AND script = ${row}.script AND utxo_count = 0;
  `;
}

export class TokenStore {
  readonly db;
  readonly network;
  readonly startHeight;
  readonly #write;
  readonly undoDepth;
  readonly authbases;

  constructor(input: { path: string; network: z.input<typeof network>; startHeight: number; undoDepth?: number; authbases?: string[] }) {
    this.authbases = [...new Set(z.array(hash).max(1000).parse(input.authbases ?? []))].sort();
    this.undoDepth = z.number().int().min(1).max(100000).parse(input.undoDepth ?? 288);
    this.network = network.parse(input.network);
    this.startHeight = z.number().int().nonnegative().parse(input.startHeight);
    if (input.path !== ':memory:') mkdirSync(dirname(input.path), { recursive: true });
    this.db = new DatabaseSync(input.path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const storedVersion = this.getMeta('schema_version');
    if (storedVersion !== null && !['3', '4'].includes(storedVersion)) {
      this.db.close();
      throw new IndexerError({ message: 'Unsupported database schema version; rescan into a new database' });
    }
    const storedNetwork = this.getMeta('network');
    const storedStart = this.getMeta('start_height');
    if ((storedNetwork !== null && storedNetwork !== this.network) ||
        (storedStart !== null && storedStart !== String(this.startHeight))) {
      this.db.close();
      throw new IndexerError({ message: 'Database network/start height differs from configuration; use a separate database' });
    }
    this.db.function('token_add', { deterministic: true }, (left: SQLOutputValue, right: SQLOutputValue) =>
      (BigInt(z.string().parse(left)) + BigInt(z.string().parse(right))).toString());
    this.db.aggregate('token_sum', {
      start: 0n,
      step: (total: bigint, value: SQLOutputValue) => total + BigInt(z.string().parse(value)),
      result: (total: bigint) => total.toString(),
    });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blocks (
        height INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, previous_hash TEXT, timestamp INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transactions (
        txid TEXT PRIMARY KEY, height INTEGER NOT NULL REFERENCES blocks(height) ON DELETE CASCADE,
        position INTEGER NOT NULL, output_satoshis TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outputs (
        txid TEXT NOT NULL REFERENCES transactions(txid) ON DELETE CASCADE,
        vout INTEGER NOT NULL, category TEXT NOT NULL, amount TEXT NOT NULL,
        capability TEXT, commitment TEXT, script TEXT NOT NULL, satoshis TEXT NOT NULL,
        unspendable INTEGER NOT NULL, spent_by TEXT REFERENCES transactions(txid) ON DELETE SET NULL,
        PRIMARY KEY (txid, vout)
      );
      CREATE INDEX IF NOT EXISTS outputs_category ON outputs(category, spent_by, unspendable);
      CREATE INDEX IF NOT EXISTS outputs_script ON outputs(script, spent_by, unspendable);
      CREATE INDEX IF NOT EXISTS outputs_spent ON outputs(spent_by);
      CREATE TABLE IF NOT EXISTS movements (
        txid TEXT NOT NULL REFERENCES transactions(txid) ON DELETE CASCADE,
        category TEXT NOT NULL, fungible_delta TEXT NOT NULL, nft_delta INTEGER NOT NULL,
        PRIMARY KEY(txid, category)
      );
      CREATE INDEX IF NOT EXISTS movements_category ON movements(category);
      CREATE INDEX IF NOT EXISTS transactions_height ON transactions(height, position);
      CREATE TABLE IF NOT EXISTS token_geneses (
        category TEXT PRIMARY KEY, txid TEXT NOT NULL REFERENCES transactions(txid) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS category_first_seen (
        category TEXT PRIMARY KEY, txid TEXT NOT NULL REFERENCES transactions(txid) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS category_totals (
        category TEXT PRIMARY KEY, supply TEXT NOT NULL,
        nft_count INTEGER NOT NULL CHECK(nft_count >= 0),
        minting_count INTEGER NOT NULL CHECK(minting_count >= 0),
        utxo_count INTEGER NOT NULL CHECK(utxo_count >= 0)
      );
      CREATE TABLE IF NOT EXISTS holder_balances (
        category TEXT NOT NULL, script TEXT NOT NULL, amount TEXT NOT NULL,
        nft_count INTEGER NOT NULL CHECK(nft_count >= 0),
        utxo_count INTEGER NOT NULL CHECK(utxo_count >= 0), PRIMARY KEY(category, script)
      );
      CREATE INDEX IF NOT EXISTS holders_by_script ON holder_balances(script, category);
      CREATE INDEX IF NOT EXISTS holders_by_amount ON holder_balances(category, length(amount) DESC, amount DESC, script);
      CREATE TRIGGER IF NOT EXISTS outputs_first_seen AFTER INSERT ON outputs BEGIN
        INSERT OR IGNORE INTO category_first_seen VALUES (NEW.category, NEW.txid);
        INSERT OR IGNORE INTO category_totals VALUES (NEW.category, '0', 0, 0, 0);
      END;
      CREATE TRIGGER IF NOT EXISTS outputs_add_live AFTER INSERT ON outputs
        WHEN NEW.spent_by IS NULL AND NEW.unspendable = 0 BEGIN ${addLiveOutput('NEW')} END;
      CREATE TRIGGER IF NOT EXISTS outputs_remove_live AFTER DELETE ON outputs
        WHEN OLD.spent_by IS NULL AND OLD.unspendable = 0 BEGIN ${removeLiveOutput('OLD')} END;
      CREATE TRIGGER IF NOT EXISTS outputs_spend_live AFTER UPDATE OF spent_by ON outputs
        WHEN OLD.spent_by IS NULL AND NEW.spent_by IS NOT NULL AND OLD.unspendable = 0
        BEGIN ${removeLiveOutput('OLD')} END;
      CREATE TRIGGER IF NOT EXISTS outputs_restore_live AFTER UPDATE OF spent_by ON outputs
        WHEN OLD.spent_by IS NOT NULL AND NEW.spent_by IS NULL AND NEW.unspendable = 0
        BEGIN ${addLiveOutput('NEW')} END;
    `);
    try {
      migrateBinary(this.db, storedVersion);
      setupAuthchains(this.db, storedVersion === '3' ? this.tip()?.height ?? null : null);
      const previousBases = this.getMeta('authchain_bases');
      if (previousBases !== null && previousBases !== JSON.stringify(this.authbases)) {
        throw new IndexerError({ message: 'AUTHCHAIN_BASES changed; rescan into a separate database to recover identity history' });
      }
      setupIdentities(this.db, this.startHeight);
      setupResolutions(this.db);
      setupActivity(this.db, this.startHeight);
      this.setMeta('authchain_bases', JSON.stringify(this.authbases));
    } catch (cause) {
      this.db.close();
      throw cause;
    }
    this.#write = {
      block: this.db.prepare('INSERT INTO blocks VALUES (?, ?, ?, ?)'),
      transaction: this.db.prepare('INSERT INTO transactions VALUES (?, ?, ?, ?)'),
      output: this.db.prepare('INSERT INTO outputs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)'),
      outpoint: this.db.prepare('SELECT * FROM outputs WHERE txid = ? AND vout = ?'),
      spend: this.db.prepare('UPDATE outputs SET spent_by = ? WHERE txid = ? AND vout = ? AND spent_by IS NULL'),
      movement: this.db.prepare('INSERT INTO movements(txid, category, fungible_delta, nft_delta, fungible_issued, fungible_burned) VALUES (?, ?, ?, ?, ?, ?)'),
      genesis: this.db.prepare('INSERT INTO token_geneses VALUES (?, ?)'),
    };
    this.setMeta('schema_version', '4');
    this.setMeta('network', this.network);
    this.setMeta('start_height', String(this.startHeight));
  }

  getMeta(key: string) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? z.object({ value: z.string() }).parse(row).value : null;
  }

  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  tip() {
    const row = this.db.prepare('SELECT height, hash, previous_hash AS previousHash FROM blocks ORDER BY height DESC LIMIT 1').get();
    return row ? tipRow.parse(row) : null;
  }

  anchor() {
    const value = this.getMeta('anchor');
    return value === null ? null : z.object({ height: z.number().int(), hash }).parse(JSON.parse(value));
  }

  setAnchor(height: number, blockHash: string) {
    const anchor = { height: z.number().int().nonnegative().parse(height), hash: hash.parse(blockHash) };
    if (height !== this.startHeight - 1) throw new IndexerError({ message: 'Anchor must precede start height' });
    const previous = this.anchor();
    if (previous !== null && (previous.hash !== anchor.hash || previous.height !== anchor.height)) {
      throw new IndexerError({ message: 'Chain reorganization crossed initial anchor; rescan into a new database' });
    }
    this.setMeta('anchor', JSON.stringify(anchor));
  }

  status() {
    const checkpoint = this.getMeta('chain_checkpoint');
    const tip = this.tip();
    const activation = { mainnet: 792773, chipnet: 121957, regtest: 0 }[this.network];
    return { network: this.network, token_coverage: { status: tip === null ? 'not_indexed' : this.startHeight <= activation ? 'complete_at_indexed_tip' : 'incomplete',
      reason: tip === null ? 'No block has been committed.' : this.startHeight <= activation ? null : 'Scan began after CashTokens activation; earlier token inputs/history are missing.' }, start_height: this.startHeight, tip,
      anchor: this.anchor(), chain_checkpoint: checkpoint === null ? null
        : z.object({ height: z.number().int().nonnegative(), hash }).parse(JSON.parse(checkpoint)), genesis_hash: this.getMeta('genesis_hash'), confirmed_only: true, schema_version: 4, undo_depth: this.undoDepth,
      undo_floor: Number(this.getMeta('undo_floor') ?? -1), activity_index_version: 1, activity_detail_start: Number(this.getMeta('activity_detail_start')),
      identity_index_version: 1, identity_scan_start: Number(this.getMeta('identity_scan_start') ?? this.startHeight),
      authchain_scan_start: Number(this.getMeta('authchain_scan_start') ?? this.startHeight) };
  }

  applyBlock(input: z.input<typeof rpcBlock>) {
    const block = rpcBlock.parse(input);
    const tip = this.tip();
    const expectedHeight = tip === null ? this.startHeight : tip.height + 1;
    const parent = tip?.hash ?? this.anchor()?.hash;
    if (block.height !== expectedHeight ||
        (block.height > 0 && (parent === undefined || block.previousblockhash !== parent))) {
      throw new IndexerError({ message: 'Block does not extend the indexed chain' });
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (new Set(block.tx.map(tx => tx.txid)).size !== block.tx.length) {
        throw new IndexerError({ message: 'Node block contains duplicate transaction IDs' });
      }
      this.#write.block.run(block.height, binary(block.hash), block.previousblockhash === undefined ? null : binary(block.previousblockhash), block.time);
      const transactions = block.tx.map((tx, position) => ({
        tx, position, tokenOutputs: tx.vout.filter(output => output.tokenData !== undefined),
      }));
      // CTOR is not topological: a spender can precede its creator. Make every
      // token output available before resolving any inputs, without storing ordinary BCH transactions.
      for (const { tx, position, tokenOutputs } of transactions) {
        if (tokenOutputs.length === 0) continue;
        const totalSatoshis = tx.vout.reduce((total, output) => total + BigInt(output.value.toFixed(8).replace('.', '')), 0n);
        this.#write.transaction.run(binary(tx.txid), block.height, position, totalSatoshis.toString());
        for (const output of tokenOutputs) {
          const token = output.tokenData;
          if (token === undefined) continue;
          // BCHN CScript::IsUnspendable: OP_RETURN or more than 10,000 script bytes.
          const unspendable = output.scriptPubKey.hex.startsWith('6a') || output.scriptPubKey.hex.length > 20000;
          this.#write.output.run(binary(tx.txid), output.n, binary(token.category), token.amount, token.nft?.capability ?? null,
            token.nft === undefined ? null : binary(token.nft.commitment), binary(output.scriptPubKey.hex),
            BigInt(output.value.toFixed(8).replace('.', '')).toString(), Number(unspendable));
        }
        const categories = new Set(tokenOutputs.flatMap(output => output.tokenData ? [output.tokenData.category] : []));
        for (const category of categories) {
          if (tx.vin[0] !== undefined && 'txid' in tx.vin[0] && tx.vin[0].txid === category && tx.vin[0].vout === 0) {
            this.#write.genesis.run(binary(category), binary(tx.txid));
          }
        }
      }
      const spentOutpoints = new Set<string>();
      for (const { tx, position, tokenOutputs } of transactions) {
        const spent = tx.vin.flatMap(input => {
          if (!('txid' in input)) return [];
          const key = `${input.txid}:${input.vout}`;
          if (spentOutpoints.has(key)) {
            throw new IndexerError({ message: 'Node block contains a duplicate spent outpoint' });
          }
          spentOutpoints.add(key);
          const row = this.#write.outpoint.get(binary(input.txid), input.vout);
          if (!row) return [];
          if (row.spent_by !== null || row.unspendable !== 0) {
            throw new IndexerError({ message: 'Node block attempts to spend an unavailable indexed token output' });
          }
          return [outputRow.parse(row)];
        });
        if (spent.length === 0 && tokenOutputs.length === 0) continue;
        // Burn-only transactions have no token outputs, so they were not inserted in the first pass.
        if (tokenOutputs.length === 0) {
          const totalSatoshis = tx.vout.reduce((total, output) => total + BigInt(output.value.toFixed(8).replace('.', '')), 0n);
          this.#write.transaction.run(binary(tx.txid), block.height, position, totalSatoshis.toString());
        }
        const deltas = new Map<string, { amount: bigint; nfts: number; input: bigint; output: bigint; unspendable: bigint }>();
        for (const output of spent) {
          const update = this.#write.spend.run(binary(tx.txid), binary(output.txid), output.vout);
          if (update.changes !== 1) {
            throw new IndexerError({ message: 'Indexed token output could not be spent exactly once' });
          }
          const delta = deltas.get(output.category) ?? { amount: 0n, nfts: 0, input: 0n, output: 0n, unspendable: 0n };
          delta.amount -= BigInt(output.amount);
          delta.input += BigInt(output.amount);
          delta.nfts -= output.capability === null ? 0 : 1;
          deltas.set(output.category, delta);
        }
        for (const output of tokenOutputs) {
          const token = output.tokenData;
          if (token === undefined) continue;
          const unspendable = output.scriptPubKey.hex.startsWith('6a') || output.scriptPubKey.hex.length > 20000;
          const delta = deltas.get(token.category) ?? { amount: 0n, nfts: 0, input: 0n, output: 0n, unspendable: 0n };
          delta.output += BigInt(token.amount);
          if (unspendable) delta.unspendable += BigInt(token.amount);
          if (!unspendable) {
            delta.amount += BigInt(token.amount);
            delta.nfts += token.nft === undefined ? 0 : 1;
          }
          deltas.set(token.category, delta);
        }
        for (const [category, delta] of deltas) {
          const complete = this.db.prepare('SELECT 1 FROM token_geneses WHERE category=?').get(binary(category)) !== undefined;
          const issued = delta.output > delta.input ? delta.output - delta.input : 0n;
          const burned = (delta.input > delta.output ? delta.input - delta.output : 0n) + delta.unspendable;
          this.#write.movement.run(binary(tx.txid), binary(category), delta.amount.toString(), delta.nfts,
            complete ? issued.toString() : null, complete ? burned.toString() : null);
        }
      }
      indexAuthchains(this.db, block);
      indexIdentities(this.db, block, this.authbases);
      watchResolutions(this.db, block);
      const previousFloor = Number(this.getMeta('undo_floor') ?? -1);
      const floor = Math.max(previousFloor, block.height - this.undoDepth);
      if (floor > previousFloor) {
        // Visit only the newly expired spend/creation heights, not all retained history.
        this.db.prepare(`DELETE FROM outputs WHERE spent_by IN
          (SELECT txid FROM transactions WHERE height > ? AND height <= ?) OR (unspendable = 1 AND txid IN
          (SELECT txid FROM transactions WHERE height > ? AND height <= ?))`)
          .run(previousFloor, floor, previousFloor, floor);
        this.setMeta('undo_floor', String(floor));
      }
      this.db.exec('COMMIT');
    } catch (cause) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw new IndexerError({ message: 'Block indexing failed; no partial block was committed', cause });
    }
  }

  rollbackTip() {
    const tip = this.tip();
    if (tip === null) throw new IndexerError({ message: 'No indexed block to roll back' });
    if (tip.height <= Number(this.getMeta('undo_floor') ?? -1)) {
      throw new IndexerError({ message: 'Reorganization exceeds retained undo history; rescan into a new database' });
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM blocks WHERE height = ?').run(tip.height);
      this.db.prepare('DELETE FROM authchain_resolutions').run();
      // Cascades remove first-seen/genesis rows, but totals have no FK because
      // they are updated by output triggers. Remove unreachable totals as well.
      this.db.prepare(`DELETE FROM category_totals WHERE utxo_count = 0
        AND NOT EXISTS (SELECT 1 FROM category_first_seen s WHERE s.category = category_totals.category)`).run();
      this.db.exec('COMMIT');
    } catch (cause) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw new IndexerError({ message: 'Block rollback failed', cause });
    }
    return this.tip();
  }

  listOutputs(input: z.input<typeof outputFilter> = {}) {
    const filter = outputFilter.parse(input);
    const conditions = [live];
    const params: (string | Uint8Array | number)[] = [];
    if (filter.category !== undefined) { conditions.push('o.category = ?'); params.push(binary(filter.category)); }
    if (filter.scripts !== undefined) {
      if (filter.scripts.length === 0) return [];
      conditions.push(`o.script IN (${filter.scripts.map(() => '?').join(',')})`);
      params.push(...filter.scripts.map(binary));
    }
    if (filter.nft !== undefined) conditions.push(`o.capability IS ${filter.nft ? 'NOT NULL' : 'NULL'}`);
    if (filter.capability !== undefined) { conditions.push('o.capability = ?'); params.push(filter.capability); }
    if (filter.excludeMinting === true) conditions.push("o.capability IS NOT NULL AND o.capability <> 'minting'");
    const rows = this.db.prepare(`SELECT o.* FROM outputs o WHERE ${conditions.join(' AND ')}
      ORDER BY length(o.amount) DESC, o.amount DESC, o.txid, o.vout LIMIT ? OFFSET ?`)
      .all(...params, filter.limit, filter.offset);
    return rows.map(row => {
      const output = outputRow.parse(row);
      return {
        token_category: bytea(output.category), fungible_token_amount: output.amount,
        nonfungible_token_capability: output.capability,
        nonfungible_token_commitment: output.commitment === null ? null : bytea(output.commitment),
        locking_bytecode: bytea(output.script), value_satoshis: output.satoshis,
        transaction_hash: bytea(output.txid), output_index: output.vout, spent_by: [],
      };
    });
  }

  category(input: string) {
    const category = hash.parse(input);
    const genesis = this.db.prepare(`SELECT g.txid, t.height FROM token_geneses g
      JOIN transactions t USING(txid) WHERE g.category = ?`).get(binary(category))
      ?? this.db.prepare(`SELECT s.txid, t.height FROM category_first_seen s
        JOIN transactions t USING(txid) WHERE s.category = ?`).get(binary(category));
    if (genesis === undefined) return null;
    const stats = this.db.prepare(`SELECT supply AS fungible_supply, nft_count, minting_count, utxo_count
      FROM category_totals WHERE category = ?`).get(binary(category));
    return { ...summaryRow.parse({ ...stats, category, genesis_txid: genesis.txid, genesis_height: genesis.height }),
      genesis_verified: this.db.prepare('SELECT 1 FROM token_geneses WHERE category = ?').get(binary(category)) !== undefined };
  }

  activity(input: z.infer<typeof activityPage>) { return readActivity(this.db, input); }

  genesisLocation(input: string) {
    const category = hash.parse(input);
    const raw = this.db.prepare(`SELECT g.txid, t.height, b.hash AS block_hash, b.timestamp,
      m.fungible_delta AS initial_spendable_supply, m.nft_delta AS initial_spendable_nfts
      FROM token_geneses g JOIN transactions t USING(txid) JOIN blocks b ON b.height=t.height
      JOIN movements m ON m.txid=g.txid AND m.category=g.category WHERE g.category=?`).get(binary(category));
    return raw === undefined ? null : z.object({ txid: storedHex, height: z.number(), block_hash: storedHex,
      timestamp: z.number(), initial_spendable_supply: z.string(), initial_spendable_nfts: z.number() }).parse(raw);
  }

  listCategories(input: z.input<typeof page> = {}) {
    const pagination = page.parse(input);
    const rows = this.db.prepare('SELECT category FROM category_first_seen ORDER BY category LIMIT ? OFFSET ?')
      .all(pagination.limit, pagination.offset);
    return rows.map(row => this.category(z.object({ category: storedHex.pipe(hash) }).parse(row).category));
  }

  holders(input: string, pagination: z.input<typeof page> = {}) {
    const category = hash.parse(input);
    const { limit, offset } = page.parse(pagination);
    return this.db.prepare(`SELECT script AS locking_bytecode, amount AS fungible_token_amount,
      nft_count FROM holder_balances WHERE category = ? AND utxo_count > 0
      ORDER BY length(amount) DESC, amount DESC, script
      LIMIT ? OFFSET ?`).all(binary(category), limit, offset).map(row => {
        const value = holderRow.parse(row);
        return { ...value, locking_bytecode: bytea(value.locking_bytecode) };
      });
  }

  balances(input: string, pagination: z.input<typeof page> = {}) {
    const script = hex.parse(input);
    const { limit, offset } = page.parse(pagination);
    return this.db.prepare(`SELECT category, amount AS fungible_token_amount, nft_count
      FROM holder_balances WHERE script = ? AND utxo_count > 0
      ORDER BY category LIMIT ? OFFSET ?`).all(binary(script), limit, offset).map(row =>
        z.object({ category: storedHex.pipe(hash), fungible_token_amount: z.string(), nft_count: z.number() }).parse(row));
  }

  history(input: string, pagination: { limit?: number; offset?: number } = {}) {
    const category = hash.parse(input);
    const { limit, offset } = page.extend({ limit: z.coerce.number().int().min(1).max(5000).default(100) }).parse(pagination);
    return this.db.prepare(`SELECT t.txid, t.height, b.hash AS block_hash, b.timestamp, t.output_satoshis, m.fungible_delta, m.nft_delta
      FROM movements m JOIN transactions t USING(txid) JOIN blocks b ON b.height = t.height
      WHERE m.category = ? ORDER BY t.height DESC, t.position DESC, t.txid LIMIT ? OFFSET ?`)
      .all(binary(category), limit, offset).map(row => {
        const value = historyRow.parse(row);
        return { block: { hash: bytea(value.block_hash), height: value.height, timestamp: value.timestamp },
          transaction: { hash: bytea(value.txid), input_value_satoshis: null, output_value_satoshis: value.output_satoshis },
          fungible_delta: value.fungible_delta, nft_delta: value.nft_delta };
      });
  }

  authchain(category: string, pagination: z.input<typeof page> = {}) {
    return readAuthchain(this.db, hash.parse(category), page.parse(pagination), this.status());
  }

  resolved(authbase: string, pagination: z.input<typeof page> = {}) {
    return readResolution(this.db, hash.parse(authbase), page.parse(pagination), this.tip());
  }

  identity(authbase: string, pagination: z.input<typeof page> = {}) {
    return readIdentity(this.db, hash.parse(authbase), page.parse(pagination), this.status());
  }

  close() { this.db.close(); }
}
