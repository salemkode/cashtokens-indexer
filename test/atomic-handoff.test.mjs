// DEFERRED until root test release. Serial synthetic files/processes only; no API/native execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers/promises';
import { publishHandoff } from '../scripts/atomic-handoff.mjs';
function directory() {
  const run = resolve('.build/runtime', `atomic-handoff-js-fixture-${randomUUID()}`);
  fs.mkdirSync(run, { mode: 0o700 }); return run;
}
function producer(t, run, mode) {
  const child = spawn(process.execPath, ['--max-old-space-size=96', resolve('test/helpers/atomic-handoff-fixture.mjs'), run, mode], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = once(child, 'exit'); const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exit; child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); });
  return { child, exit, lines };
}
test('final name stays absent through partial write and file fsync; concurrent reads see complete JSON', { timeout: 5000 }, async t => {
  const run = directory(), target = join(run, 'connection.json'); const { child, exit, lines } = producer(t, run, 'publish');
  assert.equal((await lines.next()).value, 'PARTIAL'); assert.equal(fs.existsSync(target), false);
  const pending = fs.readdirSync(run).find(name => name.endsWith('.pending')); assert.ok(pending);
  assert.ok(fs.statSync(join(run, pending)).size > 0 && fs.statSync(join(run, pending)).size < 32768);
  const seen = [], errors = [];
  const timer = setInterval(() => {
    try { seen.push(JSON.parse(fs.readFileSync(target, 'utf8'))); } catch (error) { if (error.code !== 'ENOENT') errors.push(error.name); }
  }, 1);
  try {
    child.stdin.write('a'); assert.equal((await lines.next()).value, 'SYNCED'); assert.equal(fs.existsSync(target), false);
    child.stdin.write('b'); assert.equal((await lines.next()).value, 'PUBLISHED'); assert.equal((await exit)[0], 0);
    for (const _ of Array(20)) { if (seen.length) break; await setTimeout(1); }
  } finally { clearInterval(timer); }
  assert.deepEqual(errors, []); assert.ok(seen.length);
  for (const value of seen) assert.deepEqual(value, { fixture: 'synthetic-only', text: 'x'.repeat(32768) });
  assert.equal(fs.statSync(target).mode & 0o777, 0o600); assert.equal(fs.readdirSync(run).some(name => name.endsWith('.pending')), false);
});
test('interrupted producer leaves no incomplete final', { timeout: 5000 }, async t => {
  const run = directory(); const { exit } = producer(t, run, 'crash'); assert.equal((await exit)[0], 17);
  assert.equal(fs.existsSync(join(run, 'connection.json')), false); assert.ok(fs.readdirSync(run).some(name => name.endsWith('.pending')));
});
test('existing handoff refuses without overwriting or creating a temp', () => {
  const run = directory(), target = join(run, 'connection.json'); fs.writeFileSync(target, 'foreign handoff sentinel');
  assert.throws(() => publishHandoff(run, 'connection.json', { replacement: true })); assert.equal(fs.readFileSync(target, 'utf8'), 'foreign handoff sentinel'); assert.deepEqual(fs.readdirSync(run), ['connection.json']);
});
test('symlink final refuses without changing its referent', () => {
  const run = directory(), other = join(run, 'foreign.json'), target = join(run, 'connection.json'); fs.writeFileSync(other, 'keep'); fs.symlinkSync(other, target);
  assert.throws(() => publishHandoff(run, 'connection.json', { replacement: true })); assert.equal(fs.readFileSync(other, 'utf8'), 'keep'); assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
});
