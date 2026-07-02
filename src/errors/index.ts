// AUTO-GENERATED — do not edit. Run `npm run generate` to update.

import type { ErrorEntry } from './types.js';

export const ERRORS: ErrorEntry[] = [
  { code: 'L0001', name: 'unexpected-character', category: 'lexical', summary: "A character that can't begin any token." },
  { code: 'L0002', name: 'unterminated-string', category: 'lexical', summary: "A string literal that doesn't end before the end of the line." },
  { code: 'S0001', name: 'unclosed-paren', category: 'syntactic', summary: "An opening '(' has no matching ')'." },
  { code: 'S0002', name: 'expected-expression', category: 'syntactic', summary: "An expression was required here but the input contained none." },
];

export const byCode = new Map(ERRORS.map(e => [e.code, e]));
