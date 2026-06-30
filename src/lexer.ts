import type { Position, Span, ErrorMarker } from './error-marker.js';
import type { Token, TokenKind } from './token.js';

export interface LexResult {
  tokens: Token[];
  errorMarkers: ErrorMarker[];
}

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isAlpha = (ch: string): boolean =>
  (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';

const KEYWORDS: Record<string, TokenKind> = {
  true: 'BOOL_LIT',
  false: 'BOOL_LIT',
  none: 'NONE_LIT',
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
    while (isAlpha(this.peek()) || isDigit(this.peek())) this.advance();
    const value = this.src.slice(start.offset, this.pos);
    const kind = KEYWORDS[value];
    if (kind === undefined) {
      return this.error('L0001', this.spanFrom(start));
    }
    return { kind, value, span: this.spanFrom(start) };
  }

  private readNumber(): Token {
    const start = this.mark();
    while (isDigit(this.peek())) this.advance();

    // Float: peek() is '.', peek(1) confirms a digit follows.
    // We only consume the dot when we are certain — this keeps '3.method()'
    // valid in later sections where '.' is the member-access operator.
    if (this.peek() === '.' && isDigit(this.peek(1))) {
      this.advance(); // '.'
      while (isDigit(this.peek())) this.advance();
      if (isAlpha(this.peek())) {
        while (isAlpha(this.peek()) || isDigit(this.peek())) this.advance();
        return this.error('L0002', this.spanFrom(start));
      }
      const value = this.src.slice(start.offset, this.pos);
      return { kind: 'FLOAT_LIT', value, span: this.spanFrom(start) };
    }

    if (isAlpha(this.peek())) {
      while (isAlpha(this.peek()) || isDigit(this.peek())) this.advance();
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

    if (isDigit(ch)) return this.readNumber();
    if (isAlpha(ch)) return this.readWord();

    // A leading-dot float like .5 looks like a number attempt, so L0002 is
    // more helpful than L0001 ("unexpected character").
    if (ch === '.' && isDigit(this.peek(1))) {
      const start = this.mark();
      this.advance(); // '.'
      while (isDigit(this.peek())) this.advance();
      return this.error('L0002', this.spanFrom(start));
    }

    const start = this.mark();
    this.advance();
    return this.error('L0001', this.spanFrom(start));
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
