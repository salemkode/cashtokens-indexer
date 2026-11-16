import { parseArgs } from 'node:util';
import { IndexerError } from '../src/model.js';
import { inspectStorage } from '../src/storage.js';

function main() {
  const { values } = parseArgs({
    options: { database: { type: 'string' }, details: { type: 'boolean', default: false }, help: { type: 'boolean', default: false } },
    allowPositionals: false,
  });
  if (values.help) {
    console.log('Usage: npm run storage-report -- --database /path/to/index.sqlite [--details]\n\nReads existing SQLite files without database writes, checkpoints, or VACUUM.\nThe default reports page/file metadata. --details also scans table counts and dbstat\nwhen available; it may be expensive on a large index. No capacity forecast is made.');
    return;
  }
  if (values.database === undefined) throw new IndexerError({ message: '--database is required. Use --help for usage.' });
  console.log(JSON.stringify(inspectStorage({ path: values.database, details: values.details }), null, 2));
}

try { main(); }
catch (cause) {
  console.error(cause instanceof IndexerError ? cause.message : 'Invalid arguments or storage report request. Use --help for usage.');
  process.exitCode = 1;
}
