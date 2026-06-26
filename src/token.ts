import type { Span } from './error-marker.js';

export type TokenKind =
  | 'INT_LIT'  // a sequence of decimal digits: 0, 42, 1000
  | 'ERROR'    // a character or run the lexer couldn't recognise
  | 'EOF';     // the sentinel that marks the end of source

export interface Token {
  kind: TokenKind;
  value: string;
  span: Span;
}
