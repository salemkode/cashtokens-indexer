import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenStore } from '../src/store.js';
import { rpcBlock } from '../src/model.js';
import { alice, bob, block, id, output, tx } from './fixtures.js';

function store() { return new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 0 }); }

test('exact supply over Number.MAX_SAFE_INTEGER, split transfer, complete burn, rollback', () => {
  const db = store();
  try {
    db.applyBlock(block(0, [tx(1, [output(id(100), '9223372036854775807')])]));
    assert.equal(db.category(id(100))?.fungible_supply, '9223372036854775807');
    db.applyBlock(block(1, [tx(2, [output(id(100), '9223372036854775800', bob), output(id(100), '7')], [{ txid: id(1), vout: 0 }])]));
    assert.equal(db.category(id(100))?.fungible_supply, '9223372036854775807');
    assert.equal(db.holders(id(100))[0]?.fungible_token_amount, '9223372036854775800');
    db.applyBlock(block(2, [tx(3, [], [{ txid: id(2), vout: 0 }, { txid: id(2), vout: 1 }])]));
    assert.equal(db.category(id(100))?.fungible_supply, '0');
    assert.equal(db.category(id(100))?.utxo_count, 0);
    assert.equal(db.history(id(100))[0]?.fungible_delta, '-9223372036854775807');
    assert.equal(db.history(id(100))[0]?.transaction.hash, `\\x${id(3)}`);
    db.rollbackTip();
    assert.equal(db.category(id(100))?.fungible_supply, '9223372036854775807');
    db.rollbackTip();
    assert.equal(db.listOutputs({ category: id(100) })[0]?.transaction_hash, `\\x${id(1)}`);
    assert.equal(db.holders(id(100))[0]?.locking_bytecode, `\\x${alice}`);
  } finally { db.close(); }
});

test('NFTs preserve empty commitment, immutable/mutable/minting and mixed fungibles', () => {
  const db = store();
  try {
    db.applyBlock(block(0, [tx(1, [
      output(id(100), '0', alice, { capability: 'none', commitment: '' }),
      output(id(100), '5', alice, { capability: 'mutable', commitment: 'aabb' }),
      output(id(100), '0', bob, { capability: 'minting', commitment: '' }),
    ])]));
    assert.deepEqual(db.category(id(100)), {
      category: id(100), genesis_txid: id(1), genesis_height: 0, genesis_verified: false,
      fungible_supply: '5', nft_count: 3, minting_count: 1, utxo_count: 3,
    });
    assert.equal(db.listOutputs({ nft: true }).length, 3);
    assert.equal(db.listOutputs({ capability: 'none' })[0]?.nonfungible_token_commitment, '\\x');
    assert.equal(db.listOutputs({ excludeMinting: true }).length, 2);
    db.applyBlock(block(1, [tx(2, [output(id(100), '5', alice, { capability: 'none', commitment: 'cc' })], [{ txid: id(1), vout: 1 }])]));
    assert.equal(db.listOutputs({ capability: 'mutable' }).length, 0);
    assert.equal(db.category(id(100))?.nft_count, 3);
    db.rollbackTip();
    assert.equal(db.listOutputs({ capability: 'mutable' })[0]?.nonfungible_token_commitment, '\\xaabb');
  } finally { db.close(); }
});

test('holders aggregate all UTXOs before pagination and script balances include NFT fungibles', () => {
  const db = store();
  try {
    db.applyBlock(block(0, [tx(1, [output(id(100), '5'), output(id(100), '6'), output(id(100), '10', bob),
      output(id(101), '3', alice, { capability: 'none', commitment: '' })])]));
    assert.deepEqual(db.holders(id(100), { limit: 1 }), [
      { locking_bytecode: `\\x${alice}`, fungible_token_amount: '11', nft_count: 0 },
    ]);
    assert.equal(db.holders(id(100), { limit: 1, offset: 1 })[0]?.fungible_token_amount, '10');
    assert.deepEqual(db.balances(alice), [
      { category: id(100), fungible_token_amount: '11', nft_count: 0 },
      { category: id(101), fungible_token_amount: '3', nft_count: 1 },
    ]);
    assert.equal(db.listCategories({ limit: 1, offset: 1 })[0]?.category, id(101));
  } finally { db.close(); }
});

test('OP_RETURN token outputs are burns and stay in history but never live supply', () => {
  const db = store();
  try {
    db.applyBlock(block(0, [tx(1, [output()])]));
    db.applyBlock(block(1, [tx(2, [output(id(100), '100', '6a0100')], [{ txid: id(1), vout: 0 }])]));
    assert.equal(db.category(id(100))?.fungible_supply, '0');
    assert.deepEqual(db.listOutputs(), []);
    assert.equal(db.history(id(100))[0]?.fungible_delta, '-100');
    db.rollbackTip();
    assert.equal(db.category(id(100))?.fungible_supply, '100');
  } finally { db.close(); }
});

test('same-block spend and rollback restore previous block with no orphaned history', () => {
  const db = store();
  try {
    db.applyBlock(block(0, [tx(1, [output()])]));
    db.applyBlock(block(1, [tx(2, [output()], [{ txid: id(1), vout: 0 }]), tx(3, [output(id(100), '90', bob)], [{ txid: id(2), vout: 0 }])]));
    assert.equal(db.category(id(100))?.fungible_supply, '90');
    db.rollbackTip();
    assert.equal(db.history(id(100)).length, 1);
    assert.equal(db.listOutputs()[0]?.transaction_hash, `\\x${id(1)}`);
  } finally { db.close(); }
});

test('malformed block, wrong parent and partial SQL failure cannot advance tip', () => {
  const db = store();
  try {
    db.applyBlock(block(0, [tx(1, [output()])]));
    assert.throws(() => db.applyBlock(block(1, [], 2001, 9999)), /extend/);
    assert.throws(() => db.applyBlock(block(1, [tx(2, [output()]), tx(2, [output()])])), /no partial/);
    assert.equal(db.tip()?.height, 0);
    assert.equal(db.history(id(100)).length, 1);
    assert.equal(db.category(id(100))?.fungible_supply, '100');
    assert.equal(rpcBlock.safeParse(block(1, [tx(2, [output(id(100), '9223372036854775808')])])).success, false);
    assert.equal(rpcBlock.safeParse(block(1, [tx(2, [output(id(100), '0')])])).success, false);
  } finally { db.close(); }
});

test('restart persists checkpoint and rejects reused DB for another network/start height', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blaze-store-'));
  const path = join(dir, 'index.sqlite');
  try {
    const db = new TokenStore({ path, network: 'mainnet', startHeight: 10 });
    db.setAnchor(9, id(1009));
    db.applyBlock(block(10, [tx(1, [output()])]));
    db.close();
    const reopened = new TokenStore({ path, network: 'mainnet', startHeight: 10 });
    assert.equal(reopened.tip()?.height, 10);
    assert.equal(reopened.category(id(100))?.fungible_supply, '100');
    assert.throws(() => reopened.setAnchor(9, id(9999)), /rescan/);
    reopened.close();
    assert.throws(() => new TokenStore({ path, network: 'chipnet', startHeight: 10 }), /differs/);
    assert.throws(() => new TokenStore({ path, network: 'mainnet', startHeight: 0 }), /differs/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('May 2026 NFT commitments up to 128 bytes and BCHN unspendable script length', () => {
  const db = store();
  try {
    db.applyBlock(block(0, [tx(1, [
      output(id(100), '0', alice, { capability: 'none', commitment: 'ab'.repeat(128) }),
      output(id(100), '2', '51'.repeat(10000)),
      output(id(100), '3', '51'.repeat(10001)),
    ])]));
    assert.equal(db.category(id(100))?.fungible_supply, '2');
    assert.equal(db.category(id(100))?.nft_count, 1);
    assert.equal(db.category(id(100))?.utxo_count, 2);
    assert.equal(db.listOutputs({ nft: true })[0]?.nonfungible_token_commitment?.length, 258);
    assert.equal(rpcBlock.safeParse(block(1, [tx(2, [output(id(100), '0', alice,
      { capability: 'none', commitment: 'ab'.repeat(129) })])])).success, false);
  } finally { db.close(); }
});

test('CTOR resolves a token spend before its creator while preserving original positions', () => {
  const db = store();
  try {
    db.applyBlock(block(0, [tx(1, [output()])]));
    db.applyBlock(block(1, [
      tx(2, [output(id(100), '90', bob)], [{ txid: id(3), vout: 0 }]),
      tx(3, [output()], [{ txid: id(1), vout: 0 }]),
    ]));
    assert.equal(db.category(id(100))?.fungible_supply, '90');
    assert.equal(db.category(id(100))?.utxo_count, 1);
    assert.equal(db.listOutputs()[0]?.transaction_hash, `\\x${id(2)}`);
    assert.deepEqual(db.history(id(100)).map(item => item.transaction.hash), [id(3), id(2), id(1)].map(value => `\\x${value}`));
    assert.equal(db.history(id(100))[0]?.fungible_delta, '0');
    assert.equal(db.history(id(100))[1]?.fungible_delta, '-10');
    db.rollbackTip();
    assert.equal(db.category(id(100))?.fungible_supply, '100');
    assert.equal(db.listOutputs()[0]?.transaction_hash, `\\x${id(1)}`);
    assert.equal(db.history(id(100)).length, 1);
  } finally { db.close(); }
});

test('CTOR indexes a reversed multi-step genesis and complete burn without retaining ordinary BCH transactions', () => {
  const db = store();
  try {
    db.applyBlock(block(0, [tx(100, [{ n: 0, value: 0.00001, scriptPubKey: { hex: alice } }])]));
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM transactions').get()?.count, 0);
    db.applyBlock(block(1, [
      tx(2, [{ n: 0, value: 0.000007, scriptPubKey: { hex: '6a' } }], [{ txid: id(3), vout: 0 }]),
      tx(3, [output(id(100), '100', bob)], [{ txid: id(9), vout: 0 }]),
      tx(9, [output()], [{ txid: id(100), vout: 0 }]),
    ]));
    assert.equal(db.category(id(100))?.fungible_supply, '0');
    assert.equal(db.category(id(100))?.genesis_txid, id(9));
    assert.equal(db.category(id(100))?.genesis_height, 1);
    assert.deepEqual(db.listOutputs(), []);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM transactions').get()?.count, 3);
    assert.deepEqual(db.history(id(100)).map(item => item.fungible_delta), ['100', '0', '-100']);
    db.rollbackTip();
    assert.equal(db.category(id(100)), null);
    assert.deepEqual(db.history(id(100)), []);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM token_geneses').get()?.count, 0);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM transactions').get()?.count, 0);
  } finally { db.close(); }
});

test('CTOR resolves reversed NFT mutation and rejects duplicate spends atomically', () => {
  const db = store();
  try {
    db.applyBlock(block(0, [tx(1, [output(id(100), '5', alice, { capability: 'mutable', commitment: 'aa' })])]));
    db.applyBlock(block(1, [
      tx(2, [output(id(100), '5', bob, { capability: 'none', commitment: 'cc' })], [{ txid: id(3), vout: 0 }]),
      tx(3, [output(id(100), '5', alice, { capability: 'mutable', commitment: 'bb' })], [{ txid: id(1), vout: 0 }]),
    ]));
    assert.equal(db.category(id(100))?.fungible_supply, '5');
    assert.equal(db.category(id(100))?.nft_count, 1);
    assert.equal(db.listOutputs({ nft: true })[0]?.nonfungible_token_commitment, '\\xcc');
    const duplicateInputs = [{ txid: id(2), vout: 0 }, { txid: id(2), vout: 0 }];
    assert.throws(() => db.applyBlock(block(2, [tx(4, [], duplicateInputs)])), /no partial/);
    assert.throws(() => db.applyBlock(block(2, [tx(4, [], [{ txid: id(2), vout: 0 }]), tx(5, [], [{ txid: id(2), vout: 0 }])])), /no partial/);
    assert.equal(db.tip()?.height, 1);
    assert.equal(db.category(id(100))?.nft_count, 1);
    assert.equal(db.listOutputs({ nft: true })[0]?.transaction_hash, `\\x${id(2)}`);
    db.rollbackTip();
    assert.equal(db.listOutputs({ nft: true })[0]?.nonfungible_token_commitment, '\\xaa');
  } finally { db.close(); }
});

test('older database schemas require a rescan for CTOR and materialized totals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blaze-schema-'));
  const path = join(dir, 'index.sqlite');
  try {
    for (const version of ['1', '2']) {
      const currentPath = `${path}-${version}`;
      const db = new TokenStore({ path: currentPath, network: 'regtest', startHeight: 0 });
      assert.equal(db.status().schema_version, 4);
      db.setMeta('schema_version', version);
      db.close();
      assert.throws(() => new TokenStore({ path: currentPath, network: 'regtest', startHeight: 0 }), /rescan into a new database/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function assertMaterializedTotals(db: TokenStore) {
  const actualCategories = db.db.prepare(`SELECT category, supply, nft_count, minting_count, utxo_count
    FROM category_totals WHERE category IN (SELECT category FROM category_first_seen) ORDER BY category`)
    .all().map(row => ({ ...row }));
  const expectedCategories = db.db.prepare(`SELECT category,
    token_sum(CASE WHEN spent_by IS NULL AND unspendable = 0 THEN amount ELSE '0' END) AS supply,
    COUNT(CASE WHEN spent_by IS NULL AND unspendable = 0 THEN capability END) AS nft_count,
    COUNT(CASE WHEN spent_by IS NULL AND unspendable = 0 AND capability = 'minting' THEN 1 END) AS minting_count,
    COUNT(CASE WHEN spent_by IS NULL AND unspendable = 0 THEN 1 END) AS utxo_count
    FROM outputs GROUP BY category ORDER BY category`).all().map(row => ({ ...row }));
  assert.deepEqual(actualCategories, expectedCategories);
  const actualHolders = db.db.prepare(`SELECT category, script, amount, nft_count, utxo_count
    FROM holder_balances ORDER BY category, script`).all().map(row => ({ ...row }));
  const expectedHolders = db.db.prepare(`SELECT category, script, token_sum(amount) AS amount,
    COUNT(capability) AS nft_count, COUNT(*) AS utxo_count FROM outputs
    WHERE spent_by IS NULL AND unspendable = 0 GROUP BY category, script ORDER BY category, script`)
    .all().map(row => ({ ...row }));
  assert.deepEqual(actualHolders, expectedHolders);
}

test('materialized totals match UTXOs through CTOR, burns, mutations and every rollback', () => {
  const db = store();
  try {
    db.applyBlock(block(0, [tx(1, [
      output(id(100), '9223372036854775807'),
      output(id(101), '0', alice, { capability: 'minting', commitment: '' }),
      output(id(102), '8', '6a'),
    ])]));
    assertMaterializedTotals(db);
    db.applyBlock(block(1, [
      tx(2, [output(id(100), '9223372036854775800', bob), output(id(100), '7')], [{ txid: id(9), vout: 0 }]),
      tx(3, [output(id(101), '5', bob, { capability: 'none', commitment: 'cc' }),
        output(id(101), '0', alice, { capability: 'mutable', commitment: 'bb' })], [{ txid: id(1), vout: 1 }]),
      tx(9, [output(id(100), '9223372036854775807')], [{ txid: id(1), vout: 0 }]),
    ]));
    assertMaterializedTotals(db);
    assert.equal(db.category(id(100))?.fungible_supply, '9223372036854775807');
    db.applyBlock(block(2, [
      tx(4, [], [{ txid: id(2), vout: 0 }, { txid: id(2), vout: 1 }]),
      tx(5, [output(id(101), '5', '6a', { capability: 'none', commitment: 'cc' })], [{ txid: id(3), vout: 0 }]),
    ]));
    assertMaterializedTotals(db);
    assert.equal(db.category(id(100))?.fungible_supply, '0');
    assert.deepEqual(db.holders(id(100)), []);
    assert.equal(db.listCategories().length, 3);
    db.rollbackTip();
    assertMaterializedTotals(db);
    db.rollbackTip();
    assertMaterializedTotals(db);
    db.rollbackTip();
    assertMaterializedTotals(db);
    assert.deepEqual(db.listCategories(), []);
    assert.deepEqual(db.holders(id(101)), []);
    assert.deepEqual(db.balances(alice), []);
  } finally { db.close(); }
});

test('materialized balances survive restart and failed blocks leave them unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blaze-totals-'));
  const path = join(dir, 'index.sqlite');
  try {
    const original = new TokenStore({ path, network: 'regtest', startHeight: 0 });
    original.applyBlock(block(0, [tx(1, [output(), output(id(100), '7')])]));
    original.close();
    const reopened = new TokenStore({ path, network: 'regtest', startHeight: 0 });
    try {
      assert.equal(reopened.status().schema_version, 4);
      assert.equal(reopened.category(id(100))?.fungible_supply, '107');
      assert.equal(reopened.holders(id(100))[0]?.fungible_token_amount, '107');
      assertMaterializedTotals(reopened);
      assert.throws(() => reopened.applyBlock(block(1, [tx(2, [output(id(101), '8')], [
        { txid: id(1), vout: 0 }, { txid: id(1), vout: 0 },
      ])])), /no partial/);
      assert.equal(reopened.category(id(101)), null);
      assert.equal(reopened.category(id(100))?.fungible_supply, '107');
      assertMaterializedTotals(reopened);
      reopened.rollbackTip();
      assertMaterializedTotals(reopened);
    } finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rollback removes orphaned category totals without removing burned category history', () => {
  const db = store();
  try {
    db.applyBlock(block(0, [tx(1, [output()])]));
    db.applyBlock(block(1, [tx(2, [], [{ txid: id(1), vout: 0 }])]));
    assert.equal(db.category(id(100))?.fungible_supply, '0');
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM category_totals').get()?.count, 1);
    db.rollbackTip();
    assert.equal(db.category(id(100))?.fungible_supply, '100');
    db.rollbackTip();
    assert.equal(db.category(id(100)), null);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM category_totals').get()?.count, 0);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM holder_balances').get()?.count, 0);
  } finally { db.close(); }
});
