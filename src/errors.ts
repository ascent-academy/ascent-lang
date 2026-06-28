// Append-only registry of every diagnostic code emitted by this stage.
// A code is permanent — never reused, never renumbered, never deleted.
// To retire one, set retired: true and leave the row.

export type Category = 'lexical' | 'syntax' | 'name' | 'type' | 'runtime';

export interface ErrorEntry {
  code: string;
  name: string;
  category: Category;
  summary: string;
  retired?: boolean;
}

export const ERRORS: ErrorEntry[] = [
  // L — lexical: the characters don't form a valid token
  {
    code: 'L0001',
    name: 'unexpected-character',
    category: 'lexical',
    summary: "A character that can't begin any token."
  },
  {
    code: 'L0002',
    name: 'malformed-number',
    category: 'lexical',
    summary: 'A number literal that runs into letters (`123abc`) or uses a leading dot (`.5`).'
  },

  // S — syntax: the tokens don't form valid grammar
  {
    code: 'S0002',
    name: 'expected-expression',
    category: 'syntax',
    summary: 'An expression was required here but the input contained none.'
  },
];

export const byCode = new Map(ERRORS.map(e => [e.code, e]));
