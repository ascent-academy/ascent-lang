import { Token, TokenKind } from './token.js';
import { Position, Span, RawDiagnostic } from './diagnostic.js';

export interface LexResult {
  tokens: Token[];
  diagnostics: RawDiagnostic[];
}

const KEYWORDS: Record<string, TokenKind> = {
  fix: 'KW_FIX', mut: 'KW_MUT',
  and: 'KW_AND', or: 'KW_OR', not: 'KW_NOT', div: 'KW_DIV',
  true: 'BOOL_LIT', false: 'BOOL_LIT',
};

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isAlpha = (ch: string): boolean =>
  (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
const isIdentChar = (ch: string): boolean => isAlpha(ch) || isDigit(ch);

export class Lexer {
  private pos = 0;
  private line = 1;
  private col = 1;
  private src: string;
  private diagnostics: RawDiagnostic[] = [];

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

  private match(expected: string): boolean {
    if (this.peek() === expected) {
      this.advance();
      return true;
    }
    return false;
  }

  // ---- positions & diagnostics --------------------------------------------
  // The lexer emits FACTS only — a stable code plus the span it covers. No
  // user-facing prose lives here; messages.ts owns every sentence (whitepaper
  // §9). The `error()` signature can't even accept a string, so prose can't
  // leak back in.

  private mark(): Position {
    return { offset: this.pos, line: this.line, column: this.col };
  }

  private spanFrom(start: Position): Span {
    return { start, end: this.mark() };
  }

  private error(code: string, span: Span): Token {
    this.diagnostics.push({ code, span });
    return { kind: 'ERROR', value: '', line: span.start.line, col: span.start.column };
  }

  // ---- driver -------------------------------------------------------------

  public tokenize(): LexResult {
    const tokens: Token[] = [];
    while (true) {
      const tok = this.nextToken();
      tokens.push(tok);
      if (tok.kind === 'EOF') break;
    }
    return { tokens, diagnostics: this.diagnostics };
  }

  private skipTrivia(): void {
    while (true) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.advance();
      } else if (ch === '#' && this.peek(1) === '[') {
        const start = this.mark();
        this.advance();
        this.advance();
        this.skipBlockComment(start);
      } else if (ch === '#') {
        while (this.peek() !== '\n' && this.peek() !== '\0') {
          this.advance();
        }
      } else {
        break;
      }
    }
  }

  private skipBlockComment(start: Position): void {
    let depth = 1;
    while (this.pos < this.src.length) {
      if (this.peek() === '#' && this.peek(1) === '[') {
        this.advance();
        this.advance();
        depth++;
      } else if (this.peek() === ']' && this.peek(1) === '#') {
        this.advance();
        this.advance();
        if (--depth === 0) return;
      } else {
        this.advance();
      }
    }
    // Ran off the end with the comment still open: point the span at the '#['.
    this.error('L0003', {
      start,
      end: { offset: start.offset + 2, line: start.line, column: start.column + 2 },
    });
  }

  private nextToken(): Token {
    this.skipTrivia();

    const start = this.mark();
    const tok = (kind: TokenKind, value: string): Token =>
      ({ kind, value, line: start.line, col: start.column });

    if (this.pos >= this.src.length) return tok('EOF', '');

    const ch = this.advance();

    switch (ch) {
      case '+': return tok('PLUS', '+');
      case '*': return tok('STAR', '*');
      case '/': return tok('SLASH', '/');
      case ';': return tok('SEMICOLON', ';');
      case ',': return tok('COMMA', ',');
      case ':': return tok('COLON', ':');
      case '(': return tok('LPAREN', '(');
      case ')': return tok('RPAREN', ')');
      case '{': return tok('LBRACE', '{');
      case '}': return tok('RBRACE', '}');
      case '[': return tok('LBRACKET', '[');
      case ']': return tok('RBRACKET', ']');
      case '-': return this.match('>') ? tok('ARROW', '->') : tok('MINUS', '-');
      case '=': return this.match('>') ? tok('FAT_ARROW', '=>')
        : this.match('=') ? tok('EQ_EQ', '==')
          : tok('EQ', '=');
      case '!': return this.match('=') ? tok('BANG_EQ', '!=')
        : this.error('L0001', this.spanFrom(start));
      case '<': return this.match('=') ? tok('LT_EQ', '<=') : tok('LT', '<');
      case '>': return this.match('=') ? tok('GT_EQ', '>=') : tok('GT', '>');
      case '?': return this.match('?') ? tok('QUESTION_QUESTION', '??')
        : this.error('L0001', this.spanFrom(start));
      case '.':
        if (this.peek() === '.') {
          this.advance();
          return this.peek() === '.'
            ? (this.advance(), tok('DOT_DOT_DOT', '...'))
            : tok('DOT_DOT', '..');
        }
        // '.5' — a leading-dot float, which Ascent doesn't allow.
        if (isDigit(this.peek())) return this.readMalformedNumber(start);
        return tok('DOT', '.');
      case '"': return this.readString(start);
      default:
        if (isDigit(ch)) return this.readNumber(start);
        if (isAlpha(ch)) return this.readIdent(start);
        return this.error('L0001', this.spanFrom(start));
    }
  }

  private readNumber(start: Position): Token {
    while (isDigit(this.peek())) this.advance();

    let isFloat = false;
    if (this.peek() === '.' && isDigit(this.peek(1))) {
      isFloat = true;
      this.advance(); // '.'
      while (isDigit(this.peek())) this.advance();
    }

    // A number can't run straight into letters: 123abc, 1e10, 3.5x.
    if (isAlpha(this.peek())) {
      while (isIdentChar(this.peek())) this.advance();
      return this.error('L0002', this.spanFrom(start));
    }

    const value = this.src.slice(start.offset, this.pos);
    return { kind: isFloat ? 'FLOAT_LIT' : 'INT_LIT', value, line: start.line, col: start.column };
  }

  // Reached after '.<digit>' — consume the whole bad run so the span covers it,
  // then report it as malformed (the message reads the text to tailor itself).
  private readMalformedNumber(start: Position): Token {
    while (isDigit(this.peek())) this.advance();
    if (this.peek() === '.' && isDigit(this.peek(1))) {
      this.advance();
      while (isDigit(this.peek())) this.advance();
    }
    while (isIdentChar(this.peek())) this.advance();
    return this.error('L0002', this.spanFrom(start));
  }

  private readIdent(start: Position): Token {
    while (isIdentChar(this.peek())) this.advance();
    const value = this.src.slice(start.offset, this.pos);
    const kind = KEYWORDS[value] ?? 'IDENT';
    return { kind, value, line: start.line, col: start.column };
  }

  private readString(start: Position): Token {
    let s = '';
    while (this.peek() !== '"' && this.peek() !== '\0') {
      if (this.peek() === '\\') {
        const escStart = this.mark();
        this.advance();             // '\'
        const esc = this.advance(); // escaped char
        switch (esc) {
          case '"': s += '"'; break;
          case '\\': s += '\\'; break;
          case 'n': s += '\n'; break;
          case 't': s += '\t'; break;
          case 'r': s += '\r'; break;
          default: this.error('L0004', this.spanFrom(escStart));
        }
      } else {
        s += this.advance();
      }
    }

    if (this.peek() === '\0') {
      return this.error('L0005', this.spanFrom(start));
    }

    this.advance(); // closing '"'
    return {
      kind: 'STRING_LIT',
      value: s,
      line: start.line,
      col: start.column
    };
  }
}
