import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';

/** Preserve prior measured artifacts; the stable latest file is a convenience copy, never the only evidence. */
export function writeReport(name: string, data: unknown) {
  const safeName = z.string().regex(/^[a-z0-9-]+$/).parse(name);
  const document = z.json().parse(data);
  const directory = '.build/reports';
  const archive = join(directory, 'archive');
  mkdirSync(archive, { recursive: true });
  const latest = join(directory, `${safeName}.json`);
  if (existsSync(latest)) writeFileSync(join(archive, `${safeName}-previous-${Date.now()}-${randomUUID()}.json`), readFileSync(latest), { flag: 'wx' });
  const text = `${JSON.stringify(document, null, 2)}\n`;
  const path = join(archive, `${safeName}-${Date.now()}-${randomUUID()}.json`);
  writeFileSync(path, text, { flag: 'wx' });
  writeFileSync(latest, text);
  return { latest, archive: path };
}
