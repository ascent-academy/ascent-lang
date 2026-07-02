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

const rows = entries
  .map(e => {
    const parts = [
      `code: '${e.code}'`,
      `name: '${e.name}'`,
      `category: '${e.category}'`,
      `summary: ${JSON.stringify(e.summary)}`,
      ...(e.retired ? [`retired: true`] : []),
    ];
    return `  { ${parts.join(', ')} },`;
  })
  .join('\n');

const output = `// AUTO-GENERATED — do not edit. Run \`npm run generate\` to update.

import type { ErrorEntry } from './types.js';

export const ERRORS: ErrorEntry[] = [
${rows}
];

export const byCode = new Map(ERRORS.map(e => [e.code, e]));
`;

writeFileSync(outFile, output);
console.log(`Generated ${entries.length} error entries → src/errors/generated.ts`);
