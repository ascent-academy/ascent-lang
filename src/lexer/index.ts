import type { Span, ErrorMarker } from '../errors/marker.js';
import type { Token, TokenKind } from '../token.js';
import { isDigit, isAlpha, isWhitespace } from './chars.js';
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

  private error(code: string, span: Span): Token {
    this.errorMarkers.push({ code, span });
    return { kind: 'ERROR', value: '', span };
  }

  private skipWhitespace(): void {
    while (isWhitespace(this.c.peek())) {
      this.c.advance();
    }
  }

  private readWord(): Token {
    const start = this.c.mark();
    const firstCh = this.c.peek();
    while (isAlpha(this.c.peek()) || isDigit(this.c.peek())) {
      this.c.advance();
    }
    const value = this.c.slice(start);
    const span = this.c.spanFrom(start);

    if (firstCh >= 'A' && firstCh <= 'Z') {
      // Uppercase-starting: check built-in constructors (True, False, None).
      // All other uppercase names are type/constructor names not in scope
      // until stage 4 (types).
      const kind = CONSTRUCTORS[value];
      return kind !== undefined ? { kind, value, span } : this.error('L0001', span);
    }

    const kind = KEYWORDS[value];
    return kind !== undefined ? { kind, value, span } : { kind: 'SLOT', value, span };
  }

  private readNumber(): Token {
    const start = this.c.mark();
    while (isDigit(this.c.peek())) {
      this.c.advance();
    }

    // Float: peek() is '.', peek(1) confirms a digit follows.
    // We only consume the dot when we are certain — this keeps '3.method()'
    // valid in later sections where '.' is the member-access operator.
    if (this.c.peek() === '.' && isDigit(this.c.peek(1))) {
      this.c.advance(); // '.'
      while (isDigit(this.c.peek())) {
        this.c.advance();
      }
      if (isAlpha(this.c.peek())) {
        while (isAlpha(this.c.peek()) || isDigit(this.c.peek())) {
          this.c.advance();
        }
        return this.error('L0002', this.c.spanFrom(start));
      }
      const value = this.c.slice(start);
      return { kind: 'FLOAT_LIT', value, span: this.c.spanFrom(start) };
    }

    if (isAlpha(this.c.peek())) {
      while (isAlpha(this.c.peek()) || isDigit(this.c.peek())) {
        this.c.advance();
      }
      return this.error('L0002', this.c.spanFrom(start));
    }

    const value = this.c.slice(start);
    return { kind: 'INT_LIT', value, span: this.c.spanFrom(start) };
  }

  private nextToken(): Token {
    this.skipWhitespace();

    if (this.c.atEnd()) {
      const start = this.c.mark();
      return { kind: 'EOF', value: '', span: this.c.spanFrom(start) };
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
      while (isDigit(this.c.peek())) {
        this.c.advance();
      }
      return this.error('L0002', this.c.spanFrom(start));
    }

    const start = this.c.mark();
    this.c.advance();

    switch (ch) {
      case '+': return { kind: 'PLUS', value: '+', span: this.c.spanFrom(start) };
      case '-': return { kind: 'MINUS', value: '-', span: this.c.spanFrom(start) };
      case '*': return { kind: 'STAR', value: '*', span: this.c.spanFrom(start) };
      case '/': return { kind: 'SLASH', value: '/', span: this.c.spanFrom(start) };
      case '=':
        if (this.c.match('=')) return { kind: 'EQ_EQ', value: '==', span: this.c.spanFrom(start) };
        return { kind: 'EQUALS', value: '=', span: this.c.spanFrom(start) };
      case '!':
        // Bare '!' has no meaning — negation is the word 'not' (§5), so
        // only '!=' is a valid token starting with '!'.
        if (this.c.match('=')) return { kind: 'BANG_EQ', value: '!=', span: this.c.spanFrom(start) };
        return this.error('L0001', this.c.spanFrom(start));
      case '<':
        if (this.c.match('=')) return { kind: 'LT_EQ', value: '<=', span: this.c.spanFrom(start) };
        return { kind: 'LT', value: '<', span: this.c.spanFrom(start) };
      case '>':
        if (this.c.match('=')) return { kind: 'GT_EQ', value: '>=', span: this.c.spanFrom(start) };
        return { kind: 'GT', value: '>', span: this.c.spanFrom(start) };
      case ';': return { kind: 'SEMICOLON', value: ';', span: this.c.spanFrom(start) };
      case '(': return { kind: 'LPAREN', value: '(', span: this.c.spanFrom(start) };
      case ')': return { kind: 'RPAREN', value: ')', span: this.c.spanFrom(start) };
      case '{': return { kind: 'LBRACE', value: '{', span: this.c.spanFrom(start) };
      case '}': return { kind: 'RBRACE', value: '}', span: this.c.spanFrom(start) };
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
