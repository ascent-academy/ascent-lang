// Approved

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
  for: 'KW_FOR',
  in: 'KW_IN',
  program: 'KW_PROGRAM',
  type: 'KW_TYPE',
  void: 'KW_VOID',
  match: 'KW_MATCH',
  fn: 'KW_FN',
  return: 'KW_RETURN',
  abort: 'KW_ABORT',
  orfail: 'KW_ORFAIL',
  try: 'KW_TRY',
  with: 'KW_WITH',
  async: 'KW_ASYNC',
  await: 'KW_AWAIT',
};

export const CONSTRUCTORS: Record<string, TokenKind> = {
  True: 'BOOL_LIT',
  False: 'BOOL_LIT',
  None: 'NONE_LIT',
  Done: 'DONE_LIT',
};

export const resolveWord = (value: string, firstCh: string): TokenKind | null => {
  // Every UpperCamel identifier is a TYPE_NAME — a type name or a record
  // constructor, disambiguated by position (design.md §2's casing rule). The
  // built-in types (Int, Float, …) and user-declared types alike arrive this
  // way, carrying their own text; only the reserved value constructors
  // (True/False/None/Done) get a distinct literal token.
  if (firstCh >= 'A' && firstCh <= 'Z') {
    return CONSTRUCTORS[value] ?? 'TYPE_NAME';
  }

  // Object.hasOwn: a lowercase identifier like 'toString' or 'constructor' would
  // otherwise resolve to the inherited Object.prototype method
  return Object.hasOwn(KEYWORDS, value) ? KEYWORDS[value]! : 'SLOT';
}
