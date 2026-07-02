// AUTO-GENERATED — do not edit. Run `npm run generate` to update.

import type { ErrorEntry } from './types.js';

export const ERRORS: ErrorEntry[] = [
  { code: 'L0001', name: 'unexpected-character', category: 'lexical', summary: "A character that can't begin any token." },
  { code: 'L0002', name: 'unterminated-string', category: 'lexical', summary: "A string literal that doesn't end before the end of the line." },
  { code: 'N0001', name: 'undefined-slot', category: 'name', summary: "A name was used that has not been declared with 'fix' or 'mut'." },
  { code: 'S0001', name: 'unclosed-paren', category: 'syntactic', summary: "An opening '(' has no matching ')'." },
  { code: 'S0002', name: 'expected-expression', category: 'syntactic', summary: "An expression was required here but the input contained none." },
  { code: 'S0003', name: 'expected-slot-name', category: 'syntactic', summary: "A slot name (lowercase identifier) was expected after 'fix'." },
  { code: 'S0004', name: 'expected-equals', category: 'syntactic', summary: "An '=' was expected after the slot name in a 'fix' declaration." },
  { code: 'S0005', name: 'unclosed-brace', category: 'syntactic', summary: "An opening '{' has no matching '}'." },
  { code: 'S0006', name: 'expected-test-paren', category: 'syntactic', summary: "An '(' was expected here to start the condition." },
  { code: 'S0007', name: 'expected-block', category: 'syntactic', summary: "A block ('{ … }') was expected here." },
  { code: 'S0008', name: 'chained-comparison', category: 'syntactic', summary: "Comparisons don't chain — 'a < b < c' isn't valid. Group with parentheses instead." },
];

export const byCode = new Map(ERRORS.map(e => [e.code, e]));
