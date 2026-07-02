import type { Position, Span, ErrorMarker } from './errors/marker.js';
import type { Token, TokenKind } from './token.js';

export interface LexResult {
  tokens: Token[];
  errorMarkers: ErrorMarker[];
}

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isAlpha = (ch: string): boolean =>
  (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';

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
  private src: string;
  private pos: number = 0;
  private line: number = 1;
  private col: number = 1;
  private errorMarkers: ErrorMarker[] = [];

  public constructor(src: string) {
    this.src = src;
  }

  private peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '\0';
  }

  private advance(): string {
    const ch = this.src[this.pos++] ?? '\0';
    if (ch === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  private mark(): Position {
    return { offset: this.pos, line: this.line, column: this.col };
  }

  private spanFrom(start: Position): Span {
    return { start, end: this.mark() };
  }

  private error(code: string, span: Span): Token {
    this.errorMarkers.push({ code, span });
    return { kind: 'ERROR', value: '', span };
  }

  private skipWhitespace(): void {
    while (
      this.peek() === ' ' ||
      this.peek() === '\t' ||
      this.peek() === '\n' ||
      this.peek() === '\r'
    ) {
      this.advance();
    }
  }

  private readWord(): Token {
    const start = this.mark();
    const firstCh = this.peek();
    while (isAlpha(this.peek()) || isDigit(this.peek())) {
      this.advance();
    }
    const value = this.src.slice(start.offset, this.pos);
    const span = this.spanFrom(start);

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
    const start = this.mark();
    while (isDigit(this.peek())) {
      this.advance();
    }

    // Float: peek() is '.', peek(1) confirms a digit follows.
    // We only consume the dot when we are certain — this keeps '3.method()'
    // valid in later sections where '.' is the member-access operator.
    if (this.peek() === '.' && isDigit(this.peek(1))) {
      this.advance(); // '.'
      while (isDigit(this.peek())) {
        this.advance();
      }
      if (isAlpha(this.peek())) {
        while (isAlpha(this.peek()) || isDigit(this.peek())) {
          this.advance();
        }
        return this.error('L0002', this.spanFrom(start));
      }
      const value = this.src.slice(start.offset, this.pos);
      return { kind: 'FLOAT_LIT', value, span: this.spanFrom(start) };
    }

    if (isAlpha(this.peek())) {
      while (isAlpha(this.peek()) || isDigit(this.peek())) {
        this.advance();
      }
      return this.error('L0002', this.spanFrom(start));
    }

    const value = this.src.slice(start.offset, this.pos);
    return { kind: 'INT_LIT', value, span: this.spanFrom(start) };
  }

  private nextToken(): Token {
    this.skipWhitespace();

    if (this.pos >= this.src.length) {
      const start = this.mark();
      return { kind: 'EOF', value: '', span: this.spanFrom(start) };
    }

    const ch = this.peek();

    if (isDigit(ch)) {
      return this.readNumber();
    }
    if (isAlpha(ch)) {
      return this.readWord();
    }

    // A leading-dot float like .5 looks like a number attempt, so L0002 is
    // more helpful than L0001 ("unexpected character").
    if (ch === '.' && isDigit(this.peek(1))) {
      const start = this.mark();
      this.advance(); // '.'
      while (isDigit(this.peek())) {
        this.advance();
      }
      return this.error('L0002', this.spanFrom(start));
    }

    const start = this.mark();
    this.advance();

    switch (ch) {
      case '+': return { kind: 'PLUS', value: '+', span: this.spanFrom(start) };
      case '-': return { kind: 'MINUS', value: '-', span: this.spanFrom(start) };
      case '*': return { kind: 'STAR', value: '*', span: this.spanFrom(start) };
      case '/': return { kind: 'SLASH', value: '/', span: this.spanFrom(start) };
      case '=':
        if (this.peek() === '=') {
          this.advance();
          return { kind: 'EQ_EQ', value: '==', span: this.spanFrom(start) };
        }
        return { kind: 'EQUALS', value: '=', span: this.spanFrom(start) };
      case '!':
        // Bare '!' has no meaning — negation is the word 'not' (§5), so
        // only '!=' is a valid token starting with '!'.
        if (this.peek() === '=') {
          this.advance();
          return { kind: 'BANG_EQ', value: '!=', span: this.spanFrom(start) };
        }
        return this.error('L0001', this.spanFrom(start));
      case '<':
        if (this.peek() === '=') {
          this.advance();
          return { kind: 'LT_EQ', value: '<=', span: this.spanFrom(start) };
        }
        return { kind: 'LT', value: '<', span: this.spanFrom(start) };
      case '>':
        if (this.peek() === '=') {
          this.advance();
          return { kind: 'GT_EQ', value: '>=', span: this.spanFrom(start) };
        }
        return { kind: 'GT', value: '>', span: this.spanFrom(start) };
      case ';': return { kind: 'SEMICOLON', value: ';', span: this.spanFrom(start) };
      case '(': return { kind: 'LPAREN', value: '(', span: this.spanFrom(start) };
      case ')': return { kind: 'RPAREN', value: ')', span: this.spanFrom(start) };
      case '{': return { kind: 'LBRACE', value: '{', span: this.spanFrom(start) };
      case '}': return { kind: 'RBRACE', value: '}', span: this.spanFrom(start) };
      default: return this.error('L0001', this.spanFrom(start));
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
