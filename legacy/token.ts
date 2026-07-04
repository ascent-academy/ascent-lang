import type { Span } from './diagnostic.js';

export type TokenKind =
  | 'INT_LIT' | 'FLOAT_LIT' | 'STRING_LIT' | 'BOOL_LIT'
  | 'IDENT'
  | 'KW_FIX' | 'KW_MUT' | 'KW_AND' | 'KW_OR' | 'KW_NOT' | 'KW_DIV'
  | 'PLUS' | 'MINUS' | 'STAR' | 'SLASH'
  | 'EQ' | 'EQ_EQ' | 'BANG_EQ'
  | 'LT' | 'LT_EQ' | 'GT' | 'GT_EQ'
  | 'QUESTION_QUESTION'
  | 'ARROW' | 'FAT_ARROW'
  | 'DOT' | 'DOT_DOT' | 'DOT_DOT_DOT'
  | 'LPAREN' | 'RPAREN' | 'LBRACE' | 'RBRACE' | 'LBRACKET' | 'RBRACKET'
  | 'SEMICOLON' | 'COLON' | 'COMMA'
  | 'ERROR'
  | 'EOF';

export interface Token {
  kind: TokenKind;
  value: string;
  span: Span;
}

