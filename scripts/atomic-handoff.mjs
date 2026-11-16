// Dedicated no-clobber handoff publisher; no runtime/reader/lifecycle changes.
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function publishHandoff(run, name, value) {
  const directory = resolve(run);
  const owner = fs.lstatSync(directory);
  if (fs.realpathSync(directory) !== directory || !owner.isDirectory() || owner.isSymbolicLink() || owner.uid !== process.getuid() || (owner.mode & 0o077) !== 0) throw new Error('Private owned run directory required');
  if (!['consumer-owner.json', 'connection.json'].includes(name)) throw new Error('Unsupported handoff name');
  const encoded = JSON.stringify(value, null, 2);
  if (typeof encoded !== 'string') throw new Error('JSON handoff value required');
  const payload = Buffer.from(encoded + '\n');
  const parent = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const temporary = join(directory, `.${name}.${randomUUID()}.pending`);
  const target = join(directory, name);
  const state = { created: null };
  function sameDirectory() {
    const current = fs.lstatSync(directory);
    const opened = fs.fstatSync(parent);
    if (current.dev !== owner.dev || current.ino !== owner.ino || opened.dev !== owner.dev || opened.ino !== owner.ino || current.uid !== process.getuid() || (current.mode & 0o077) !== 0) throw new Error('Run directory identity changed');
  }
  try {
    sameDirectory();
    try { fs.lstatSync(target); throw new Error('Existing handoff is never replaced'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const file = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
      state.created = fs.fstatSync(file);
      const position = { offset: 0 };
      while (position.offset < payload.length) {
        const written = fs.writeSync(file, payload, position.offset, payload.length - position.offset);
        if (written <= 0) throw new Error('Incomplete handoff write');
        position.offset += written;
      }
      fs.fsyncSync(file);
    } finally { fs.closeSync(file); }
    fs.fsyncSync(parent); sameDirectory();
    fs.linkSync(temporary, target); // Atomic, exclusive final name; never rename over an existing handoff.
    fs.fsyncSync(parent);
  } finally {
    try {
      if (state.created !== null) {
        const currentDirectory = fs.lstatSync(directory);
        if (currentDirectory.dev === owner.dev && currentDirectory.ino === owner.ino) {
          const current = (() => { try { return fs.lstatSync(temporary); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } })();
          if (current?.isFile() && current.uid === process.getuid() && current.dev === state.created.dev && current.ino === state.created.ino) {
            fs.unlinkSync(temporary); fs.fsyncSync(parent);
          }
        }
      }
    } finally { fs.closeSync(parent); }
  }
  return target;
}
