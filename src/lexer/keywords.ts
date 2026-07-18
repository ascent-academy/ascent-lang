// Approved

import type { TokenKind } from './token.js';

export const KEYWORDS: Map<string, TokenKind> = new Map([
  ['div', 'KW_DIV'],
  ['mod', 'KW_MOD'],
  ['and', 'KW_AND'],
  ['or', 'KW_OR'],
  ['not', 'KW_NOT'],
  ['fix', 'KW_FIX'],
  ['mut', 'KW_MUT'],
  ['if', 'KW_IF'],
  ['else', 'KW_ELSE'],
  ['while', 'KW_WHILE'],
  ['for', 'KW_FOR'],
  ['in', 'KW_IN'],
  ['program', 'KW_PROGRAM'],
  ['type', 'KW_TYPE'],
  ['void', 'KW_VOID'],
  ['match', 'KW_MATCH'],
  ['fn', 'KW_FN'],
  ['return', 'KW_RETURN'],
  ['abort', 'KW_ABORT'],
  ['orfail', 'KW_ORFAIL'],
  ['try', 'KW_TRY'],
  ['with', 'KW_WITH'],
  ['async', 'KW_ASYNC'],
  ['await', 'KW_AWAIT'],
  ['import', 'KW_IMPORT'],
  ['from', 'KW_FROM'],
]);

export const CONSTRUCTORS: Map<string, TokenKind> = new Map([
  ['True', 'BOOL_LIT'],
  ['False', 'BOOL_LIT'],
  ['None', 'NONE_LIT'],
  ['Done', 'DONE_LIT'],
]);

export const resolveWord = (value: string, firstCh: string): TokenKind | null => {
  if (firstCh >= 'A' && firstCh <= 'Z') {
    return CONSTRUCTORS.get(value) ?? 'TYPE_NAME';
  }

  return KEYWORDS.get(value) ?? 'SLOT';
}
