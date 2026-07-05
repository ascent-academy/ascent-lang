import type { Position, Span, Marker } from './token.js';
import type { Token, TokenKind } from './token.js';
import { isDigit, isAlpha, isAlphaNum, isWhitespace } from './chars.js';
import { Cursor } from './cursor.js';
import { resolveWord } from './keywords.js';

export interface LexResult {
  tokens: Token[];
  errorMarkers: Marker[];
}

export class Lexer {
  private c: Cursor;
  private errorMarkers: Marker[] = [];

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

  private skipLineComment(): void {
    this.consumeWhile((ch) => ch !== '\n' && ch !== '\0');
  }

  // '#[ ... ]#' nests: an inner '#[' bumps the depth, and only the ']#' that
  // brings it back to 0 closes the comment.
  private skipBlockComment(start: Position): void {
    let depth = 1;
    while (!this.c.atEnd()) {
      if (this.c.peek() === '#' && this.c.peek(1) === '[') {
        this.c.advance();
        this.c.advance();
        depth++;
      } else if (this.c.peek() === ']' && this.c.peek(1) === '#') {
        this.c.advance();
        this.c.advance();
        depth--;
        if (depth === 0) return;
      } else {
        this.c.advance();
      }
    }
    this.error('L0005', this.c.spanFrom(start));
  }

  private skipTrivia(): void {
    while (true) {
      this.skipWhitespace();
      if (this.c.peek() === '#' && this.c.peek(1) === '[') {
        const start = this.c.mark();
        this.c.advance();
        this.c.advance();
        this.skipBlockComment(start);
        continue;
      }
      if (this.c.peek() === '#') {
        this.skipLineComment();
        continue;
      }
      break;
    }
  }

  private readWord(): Token {
    const start = this.c.mark();
    const firstCh = this.c.peek();
    this.consumeWhile(isAlphaNum);
    const kind = resolveWord(this.c.slice(start), firstCh);
    return kind !== null ? this.token(kind, start) : this.error('L0001', this.c.spanFrom(start));
  }

  private readString(start: Position): Token {
    let value = '';
    while (true) {
      const ch = this.c.peek();
      if (ch === '\0' || ch === '\n') {
        return this.error('L0003', this.c.spanFrom(start));
      }
      if (ch === '"') {
        this.c.advance(); // consume closing '"'
        return { kind: 'STR_LIT', value, span: this.c.spanFrom(start) };
      }
      if (ch === '\\') {
        this.c.advance(); // consume '\'
        const esc = this.c.peek();
        this.c.advance(); // consume escape char
        switch (esc) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '"': value += '"'; break;
          case '\\': value += '\\'; break;
          default: return this.error('L0001', this.c.spanFrom(start));
        }
      } else {
        value += ch;
        this.c.advance();
      }
    }
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
    this.skipTrivia();

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

    // A leading-dot float like .5 is a number missing its integer part, so
    // L0004 (its own error, with a certain '0.5' fix) is more helpful than
    // L0001 ("unexpected character") or L0002 (a number run into letters).
    if (ch === '.' && isDigit(this.c.peek(1))) {
      const start = this.c.mark();
      this.c.advance(); // '.'
      this.consumeWhile(isDigit);
      return this.error('L0004', this.c.spanFrom(start));
    }

    const start = this.c.mark();
    this.c.advance();

    switch (ch) {
      case '+': return this.token('PLUS', start);
      case '-': return this.token('MINUS', start);
      case '*':
        if (this.c.match('*')) return this.token('STAR_STAR', start);
        return this.token('STAR', start);
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
      case '"': return this.readString(start);
      case '.': return this.token('DOT', start);
      case ':': return this.token('COLON', start);
      case ',': return this.token('COMMA', start);
      case ';': return this.token('SEMICOLON', start);
      case '(': return this.token('LPAREN', start);
      case ')': return this.token('RPAREN', start);
      case '{': return this.token('LBRACE', start);
      case '}': return this.token('RBRACE', start);
      case '[': return this.token('LBRACKET', start);
      case ']': return this.token('RBRACKET', start);
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
