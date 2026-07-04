import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { ErrorEntry } from '../src/errors/types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errorsDir = resolve(root, 'src/errors');
const outFile = resolve(errorsDir, 'index.ts');

const entries: ErrorEntry[] = readdirSync(errorsDir)
  .filter(f => f.endsWith('.yml'))
  .sort()
  .flatMap(f => parse(readFileSync(resolve(errorsDir, f), 'utf8')) as ErrorEntry[]);

// Entries carry nested data now (variants, fix, example), so we emit the array
// as pretty-printed JSON — a subset of TS object-literal syntax — rather than
// hand-building each row. The result is still a plain `ErrorEntry[]`.
const literal = JSON.stringify(entries, null, 2);

const output = `// AUTO-GENERATED — do not edit. Run \`npm run generate\` to update.

import type { ErrorEntry } from './types.js';

export const ERRORS: ErrorEntry[] = ${literal};

export const byCode = new Map(ERRORS.map(e => [e.code, e]));
`;

writeFileSync(outFile, output);
console.log(`Generated ${entries.length} error entries → src/errors/index.ts`);
