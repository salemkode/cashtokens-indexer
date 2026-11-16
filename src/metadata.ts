import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import schema from './bcmr-v2.schema.json' with { type: 'json' };

const ajv = new Ajv({ strict: false, allErrors: false });
addFormats.default(ajv);
const validate = ajv.compile(schema);

/** Content integrity and schema validity are not issuer authority or trust. No remote URI is fetched. */
export function verifyRegistry(bytes: Uint8Array, expectedHash: string) {
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== expectedHash) return { status: 'hash_mismatch' as const, actual_hash: actualHash, expected_hash: expectedHash };
  try {
    const document = z.json().parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (!validate(document)) return { status: 'invalid_schema' as const, actual_hash: actualHash,
      issues: validate.errors?.map(error => ({ path: error.instancePath, keyword: error.keyword })) ?? [] };
    return { status: 'verified_content' as const, actual_hash: actualHash, registry: document,
      untrusted_metadata: true as const, issuer_authority_verified: false as const };
  } catch { return { status: 'invalid_json' as const, actual_hash: actualHash }; }
}
