import { Match } from 'effect';
import { parseArgs } from 'node:util';
import { backupDatabase, restoreDatabase, validateBackup } from '../src/backup.js';
import { clearDeadWriter } from '../src/ownership.js';
import { IndexerError } from '../src/model.js';
import { z } from 'zod';

async function main() {
  const { values } = parseArgs({ options: {
    action: { type: 'string' }, database: { type: 'string' }, destination: { type: 'string' },
  } });
  const args = z.discriminatedUnion('action', [
    z.object({ action: z.literal('check'), database: z.string().min(1) }),
    z.object({ action: z.literal('unlock'), database: z.string().min(1) }),
    z.object({ action: z.literal('backup'), database: z.string().min(1), destination: z.string().min(1) }),
    z.object({ action: z.literal('restore'), database: z.string().min(1), destination: z.string().min(1) }),
  ]).parse(values);
  const result = await Match.value(args).pipe(
    Match.when({ action: 'check' }, args => validateBackup(args.database)),
    Match.when({ action: 'unlock' }, args => clearDeadWriter(args.database)),
    Match.when({ action: 'backup' }, args => backupDatabase(args.database, args.destination)),
    Match.when({ action: 'restore' }, args => restoreDatabase(args.database, args.destination)),
    Match.exhaustive,
  );
  console.log(JSON.stringify(result));
}
main().catch(cause => {
  console.error(cause instanceof IndexerError ? cause.message : 'Database operation failed. Check arguments, permissions and backup integrity.');
  process.exitCode = 1;
});
