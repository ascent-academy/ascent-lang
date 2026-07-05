import type { TokenKind } from './token.js';

export const KEYWORDS: Record<string, TokenKind> = {
  div: 'KW_DIV',
  mod: 'KW_MOD',
  and: 'KW_AND',
  or: 'KW_OR',
  not: 'KW_NOT',
  fix: 'KW_FIX',
  mut: 'KW_MUT',
  if: 'KW_IF',
  else: 'KW_ELSE',
  while: 'KW_WHILE',
  args: 'KW_ARGS',
};

export const CONSTRUCTORS: Record<string, TokenKind> = {
  True: 'BOOL_LIT',
  False: 'BOOL_LIT',
  None: 'NONE_LIT',
  Done: 'DONE_LIT',
};

const BUILTIN_TYPES: Record<string, TokenKind> = {
  Int: 'TYPE_NAME',
  Float: 'TYPE_NAME',
  Bool: 'TYPE_NAME',
  String: 'TYPE_NAME',
  List: 'TYPE_NAME',
};

export function resolveWord(value: string, firstCh: string): TokenKind | null {
  if (firstCh >= 'A' && firstCh <= 'Z') {
    return CONSTRUCTORS[value] ?? BUILTIN_TYPES[value] ?? null;
  }
  // Object.hasOwn, not a bare KEYWORDS[value] lookup: a lowercase identifier
  // like 'toString' or 'constructor' would otherwise resolve to the
  // inherited Object.prototype method instead of falling through to SLOT.
  return Object.hasOwn(KEYWORDS, value) ? KEYWORDS[value]! : 'SLOT';
}
