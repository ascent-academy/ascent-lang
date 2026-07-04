import type { TokenKind } from './token.js';

export const KEYWORDS: Record<string, TokenKind> = {
  div: 'KW_DIV',
  mod: 'KW_MOD',
  and: 'KW_AND',
  or: 'KW_OR',
  xor: 'KW_XOR',
  not: 'KW_NOT',
  fix: 'KW_FIX',
  mut: 'KW_MUT',
  if: 'KW_IF',
  else: 'KW_ELSE',
  while: 'KW_WHILE',
  args: 'KW_ARGS',
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

// Built-in type names: recognised as TYPE_NAME tokens so the parser can
// use them in type annotations (e.g. args declarations). Other uppercase
// names that are neither constructors nor type names are still L0001.
const BUILTIN_TYPES: Record<string, TokenKind> = {
  Int: 'TYPE_NAME',
  Float: 'TYPE_NAME',
  Bool: 'TYPE_NAME',
  String: 'TYPE_NAME',
  List: 'TYPE_NAME',
};

// Returns the token kind for a scanned word, or null for an unrecognised
// uppercase name (the caller must emit L0001). Lowercase words that are not
// keywords resolve to SLOT rather than null.
export function resolveWord(value: string, firstCh: string): TokenKind | null {
  if (firstCh >= 'A' && firstCh <= 'Z') {
    return CONSTRUCTORS[value] ?? BUILTIN_TYPES[value] ?? null;
  }
  return KEYWORDS[value] ?? 'SLOT';
}
