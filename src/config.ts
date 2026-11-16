import { z } from 'zod';
import { hash, network } from './model.js';

export const configSchema = z.object({
  NETWORK: network.default('mainnet'),
  BCH_RPC_URL: z.url(),
  BCH_RPC_USER: z.string().optional(),
  BCH_RPC_PASSWORD: z.string().optional(),
  BCH_RPC_COOKIE_FILE: z.string().optional(),
  SERVE_BCH_API: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),
  BCH_HISTORY_RPC_URL: z.url().optional(),
  BCH_HISTORY_RPC_USER: z.string().optional(),
  BCH_HISTORY_RPC_PASSWORD: z.string().optional(),
  BCH_HISTORY_RPC_COOKIE_FILE: z.string().optional(),
  RPC_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1).max(268435456).default(67108864),
  RPC_TIMEOUT_MS: z.coerce.number().int().min(1).max(300000).default(30000),
  EXPECTED_GENESIS_HASH: hash.optional(),
  AUTHCHAIN_BASES: z.string().default('').transform(value => value === '' ? [] : value.split(','))
    .pipe(z.array(hash).max(1000)),
  BCH_TEST_RPC_URL: z.url().optional(),
  BCH_TEST_RPC_USER: z.string().optional(),
  BCH_TEST_RPC_PASSWORD: z.string().optional(),
  BCH_TEST_RPC_COOKIE_FILE: z.string().optional(),
  TEST_RPC_PORT: z.coerce.number().int().min(0).max(65535).optional(),
  TEST_APPROVAL_FILE: z.string().min(1).optional(),
  RPC_PROXY_PORT: z.coerce.number().int().min(0).max(65535).optional(),
  MAX_SYNC_AGE_MS: z.coerce.number().int().min(100).max(3600000).default(30000),
  MIN_FREE_BYTES: z.coerce.number().int().nonnegative().safe().default(536870912),
  UNDO_DEPTH: z.coerce.number().int().min(1).max(100000).default(288),
  START_HEIGHT: z.coerce.number().int().nonnegative().default(0),
  DATABASE_PATH: z.string().min(1).default('./data/cashtokens.sqlite'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  SYNC_BATCH_SIZE: z.coerce.number().int().min(1).max(10000).default(100),
  POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(300000).default(5000),
  CORS_ORIGINS: z.string().default('https://explorer.salemkode.com,http://localhost:3000')
    .transform(value => value.split(',').map(origin => origin.trim()).filter(Boolean))
    .pipe(z.array(z.url().refine(value => new URL(value).origin === value, 'CORS entries must be origins'))),
}).refine(config => config.TEST_RPC_PORT === undefined || (config.NETWORK !== 'mainnet'
  && config.BCH_TEST_RPC_URL !== undefined && config.TEST_APPROVAL_FILE !== undefined),
{ message: 'Test RPC requires a separate test-only upstream, private approvals and Chipnet/regtest', path: ['TEST_RPC_PORT'] });
