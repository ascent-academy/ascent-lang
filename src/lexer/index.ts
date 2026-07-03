import type { Position, Span, ErrorMarker } from '../errors/marker.js';
import type { Token, TokenKind } from '../token.js';
import { isDigit, isAlpha, isAlphaNum, isWhitespace } from './chars.js';
import { Cursor } from './cursor.js';

export interface LexResult {
  tokens: Token[];
  errorMarkers: ErrorMarker[];
}

const KEYWORDS: Record<string, TokenKind> = {
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
const CONSTRUCTORS: Record<string, TokenKind> = {
  True: 'BOOL_LIT',
  False: 'BOOL_LIT',
  None: 'NONE_LIT',
  Done: 'DONE_LIT',
};

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
    const value = this.c.slice(start);

    if (firstCh >= 'A' && firstCh <= 'Z') {
      // Uppercase-starting: check built-in constructors (True, False, None).
      // All other uppercase names are type/constructor names not in scope
      // until stage 4 (types).
      const kind = CONSTRUCTORS[value];
      return kind !== undefined ? this.token(kind, start) : this.error('L0001', this.c.spanFrom(start));
    }

    const kind = KEYWORDS[value];
    return kind !== undefined ? this.token(kind, start) : this.token('SLOT', start);
  }

  private readNumber(): Token {
    const start = this.c.mark();
    this.consumeWhile(isDigit);

    // Float: peek() is '.', peek(1) confirms a digit follows.
    // We only consume the dot when we are certain — this keeps '3.method()'
    // valid in later sections where '.' is the member-access operator.
    if (this.c.peek() === '.' && isDigit(this.c.peek(1))) {
      this.c.advance(); // '.'
      this.consumeWhile(isDigit);
      if (isAlpha(this.c.peek())) {
        this.consumeWhile(isAlphaNum);
        return this.error('L0002', this.c.spanFrom(start));
      }
      return this.token('FLOAT_LIT', start);
    }

    if (isAlpha(this.c.peek())) {
      this.consumeWhile(isAlphaNum);
      return this.error('L0002', this.c.spanFrom(start));
    }

    return this.token('INT_LIT', start);
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
