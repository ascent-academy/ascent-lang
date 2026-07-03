import type { TokenKind } from '../token.js';

export const KEYWORDS: Record<string, TokenKind> = {
  div: 'KW_DIV',
  mod: 'KW_MOD',
  fix: 'KW_FIX',
  mut: 'KW_MUT',
  if: 'KW_IF',
  else: 'KW_ELSE',
  while: 'KW_WHILE',
};

// Built-in constructors: uppercase names that are part of the language
// core but are not keywords — they are non-shadowable constructor names
// (True, False, None) that happen to be built in rather than user-defined.
export const CONSTRUCTORS: Record<string, TokenKind> = {
  True: 'BOOL_LIT',
  False: 'BOOL_LIT',
  None: 'NONE_LIT',
  Done: 'DONE_LIT',
};

// Returns the token kind for a scanned word, or null for an unrecognised
// uppercase name (the caller must emit L0001). Lowercase words that are not
// keywords resolve to SLOT rather than null.
export function resolveWord(value: string, firstCh: string): TokenKind | null {
  if (firstCh >= 'A' && firstCh <= 'Z') {
    return CONSTRUCTORS[value] ?? null;
  }
  return KEYWORDS[value] ?? 'SLOT';
}
