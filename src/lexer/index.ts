import type { Position, Span, ErrorMarker } from '../errors/marker.js';
import type { Token, TokenKind } from '../token.js';
import { isDigit, isAlpha, isAlphaNum, isWhitespace } from './chars.js';
import { Cursor } from './cursor.js';
import { resolveWord } from './keywords.js';

export interface LexResult {
  tokens: Token[];
  errorMarkers: ErrorMarker[];
}

export class Lexer {
  private c: Cursor;
  private errorMarkers: ErrorMarker[] = [];

  public constructor(src: string) {
    this.c = new Cursor(src);
  }

  private token(kind: TokenKind, start: Position): Token {
    return { kind, value: this.c.slice(start), span: this.c.spanFrom(start) };
  }

  private error(code: string, span: Span): Token {
    this.errorMarkers.push({ code, span });
    return { kind: 'ERROR', value: '', span };
  }

  private consumeWhile(pred: (ch: string) => boolean): void {
    while (pred(this.c.peek())) {
      this.c.advance();
    }
  }

  private skipWhitespace(): void {
    this.consumeWhile(isWhitespace);
  }

  private readWord(): Token {
    const start = this.c.mark();
    const firstCh = this.c.peek();
    this.consumeWhile(isAlphaNum);
    const kind = resolveWord(this.c.slice(start), firstCh);
    return kind !== null ? this.token(kind, start) : this.error('L0001', this.c.spanFrom(start));
  }

  private readNumber(): Token {
    const start = this.c.mark();
    this.consumeWhile(isDigit);

    // Float: only consume the dot when a digit follows — this keeps '3.method()'
    // valid in later sections where '.' is the member-access operator.
    let kind: TokenKind = 'INT_LIT';
    if (this.c.peek() === '.' && isDigit(this.c.peek(1))) {
      this.c.advance(); // '.'
      this.consumeWhile(isDigit);
      kind = 'FLOAT_LIT';
    }

    // A number may not be glued to a letter: 123abc / 1.5x are one malformed
    // token, not a number followed by a name.
    if (isAlpha(this.c.peek())) {
      this.consumeWhile(isAlphaNum);
      return this.error('L0002', this.c.spanFrom(start));
    }

    return this.token(kind, start);
  }

  private nextToken(): Token {
    this.skipWhitespace();

    if (this.c.atEnd()) {
      const start = this.c.mark();
      return this.token('EOF', start);
    }

    const ch = this.c.peek();

    if (isDigit(ch)) {
      return this.readNumber();
    }
    if (isAlpha(ch)) {
      return this.readWord();
    }

    // A leading-dot float like .5 looks like a number attempt, so L0002 is
    // more helpful than L0001 ("unexpected character").
    if (ch === '.' && isDigit(this.c.peek(1))) {
      const start = this.c.mark();
      this.c.advance(); // '.'
      this.consumeWhile(isDigit);
      return this.error('L0002', this.c.spanFrom(start));
    }

    const start = this.c.mark();
    this.c.advance();

    switch (ch) {
      case '+': return this.token('PLUS', start);
      case '-': return this.token('MINUS', start);
      case '*': return this.token('STAR', start);
      case '/': return this.token('SLASH', start);
      case '=':
        if (this.c.match('=')) return this.token('EQ_EQ', start);
        return this.token('EQUALS', start);
      case '!':
        // Bare '!' has no meaning — negation is the word 'not' (§5), so
        // only '!=' is a valid token starting with '!'.
        if (this.c.match('=')) return this.token('BANG_EQ', start);
        return this.error('L0001', this.c.spanFrom(start));
      case '<':
        if (this.c.match('=')) return this.token('LT_EQ', start);
        return this.token('LT', start);
      case '>':
        if (this.c.match('=')) return this.token('GT_EQ', start);
        return this.token('GT', start);
      case ';': return this.token('SEMICOLON', start);
      case '(': return this.token('LPAREN', start);
      case ')': return this.token('RPAREN', start);
      case '{': return this.token('LBRACE', start);
      case '}': return this.token('RBRACE', start);
      default: return this.error('L0001', this.c.spanFrom(start));
    }
  }

  public tokenize(): LexResult {
    const tokens: Token[] = [];
    while (true) {
      const tok = this.nextToken();
      tokens.push(tok);
      if (tok.kind === 'EOF') {
        break;
      }
    }
    return { tokens, errorMarkers: this.errorMarkers };
  }
}
