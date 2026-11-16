// Tiny synthetic producer; never the bounded activity worker or a node controller.
import fs from 'node:fs';
import { publishHandoff } from '../../scripts/atomic-handoff.mjs';
const [run, mode] = process.argv.slice(2);
const originalWrite = fs.writeSync;
const originalSync = fs.fsyncSync;
const state = { partial: false, synced: false };
function wait() { fs.readSync(0, Buffer.alloc(1), 0, 1, null); }
function signal(line) { const bytes = Buffer.from(line + '\n'); originalWrite(1, bytes, 0, bytes.length); }
fs.writeSync = (fd, buffer, offset, length) => {
  const count = originalWrite(fd, buffer, offset, Math.min(length, 64));
  if (!state.partial) {
    state.partial = true;
    if (mode === 'crash') process.exit(17);
    signal('PARTIAL'); wait();
  }
  return count;
};
fs.fsyncSync = fd => {
  originalSync(fd);
  if (!state.synced && fs.fstatSync(fd).isFile()) { state.synced = true; signal('SYNCED'); wait(); }
};
publishHandoff(run, 'connection.json', { fixture: 'synthetic-only', text: 'x'.repeat(32768) });
signal('PUBLISHED');
