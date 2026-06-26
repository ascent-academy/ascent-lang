import type { Position, Span, ErrorMarker } from './error-marker.js';
import type { Token, TokenKind } from './token.js';

export interface LexResult {
  tokens: Token[];
  errorMarkers: ErrorMarker[];
}

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isAlpha = (ch: string): boolean =>
  (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';

export class Lexer {
  private src: string;
  private pos: number = 0;
  private line: number = 1;
  private col: number = 1;
  private errorMarkers: ErrorMarker[] = [];

  public constructor(src: string) {
    this.src = src;
  }

  private peek(): string {
    return this.src[this.pos] ?? '\0';
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

  private readWord(start: Position): Token {
    while (isAlpha(this.peek()) || isDigit(this.peek())) this.advance();
    return this.error('L0001', this.spanFrom(start));
  }

  private readNumber(start: Position): Token {
    while (isDigit(this.peek())) {
      this.advance();
    }

    if (isAlpha(this.peek())) {
      // Consume the whole bad run so the span covers it entirely.
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

    const start = this.mark();
    const tok = (kind: TokenKind, value: string): Token =>
      ({ kind, value, span: this.spanFrom(start) });

    if (this.pos >= this.src.length) {
      return tok('EOF', '');
    }

    const ch = this.advance();

    if (isDigit(ch)) {
      return this.readNumber(start);
    }

    if (isAlpha(ch)) {
      return this.readWord(start);
    }

    // A leading-dot float like .5 looks like a number attempt, so L0002 is
    // more helpful than L0001 ("unexpected character").
    if (ch === '.' && isDigit(this.peek())) {
      while (isDigit(this.peek())) {
        this.advance();
      }

      return this.error('L0002', this.spanFrom(start));
    }

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
