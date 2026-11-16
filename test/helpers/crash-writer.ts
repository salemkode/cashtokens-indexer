import { TokenStore } from '../../src/store.js';
import { block, tx, output } from '../fixtures.js';
import { z } from 'zod';

const path = z.string().min(1).parse(process.argv[2]);
const store = new TokenStore({ path, network: 'regtest', startHeight: 0 });
store.applyBlock(block(0, [tx(1, [output()])]));
store.db.function('fixture_crash', () => { process.kill(process.pid, 'SIGKILL'); return 0; });
store.db.exec(`CREATE TRIGGER fixture_crash_during_block BEFORE INSERT ON outputs
  WHEN NEW.vout = 25 BEGIN SELECT fixture_crash(); END`);
store.applyBlock(block(1, [tx(2, Array.from({ length: 50 }, () => output()), [{ txid: '1'.padStart(64, '0'), vout: 0 }])]));
process.exitCode = 9; // The crash must happen before this point.
