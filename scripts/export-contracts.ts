import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { activityEnvelope } from '../src/activity-contract.js';
import { authchainEnvelope } from '../src/authchain-contract.js';

writeFileSync(new URL('../docs/authchain-api-v1.schema.json', import.meta.url),
  `${JSON.stringify(z.toJSONSchema(authchainEnvelope, { io: 'input' }), null, 2)}\n`);

writeFileSync(new URL('../docs/activity-api-v1.schema.json', import.meta.url),
  `${JSON.stringify(z.toJSONSchema(activityEnvelope, { io: 'input' }), null, 2)}\n`);
