import type { Position, Span, Marker } from './token.js';
import type { Token, TokenKind } from './token.js';
import { isDigit, isAlpha, isAlphaNum, isWhitespace } from './chars.js';
import { Cursor } from './cursor.js';
import { resolveWord } from './keywords.js';

export interface LexResult {
  tokens: Token[];
  errorMarkers: Marker[];
}

// A 'string' frame is active while scanning the text of a "..." literal, and
// 'mstring' the same for a """..."""  one; an 'interp' frame is active while
// scanning the expression inside a '${ }' hole. All three stack, so a hole
// may itself contain a string (which may itself interpolate) — nesting is
// just deeper frames, not a special case. 'interp.depth' counts '{'/'}'
// opened *inside* the hole (an 'if' body, a block, …) so the '}' that
// actually closes the hole is the one seen at depth 0, never a nested one.
type LexMode =
  | { kind: 'string' }
  | { kind: 'mstring'; start: Position }
  | { kind: 'interp'; depth: number; start: Position };

export class Lexer {
  private c: Cursor;
  private errorMarkers: Marker[] = [];
  private modeStack: LexMode[] = [];

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
      if (this.c.match('#[')) {
        depth++;
      } else if (this.c.match(']#')) {
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
      const start = this.c.mark();
      if (this.c.match('#[')) {
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

  // Scans one chunk of string text: from just after the opening '"' (or just
  // after a hole's swallowed closing '}') up to whichever comes first — the
  // closing '"' (the string ends here, STR_PART_END), an unescaped '${' (a
  // hole starts — pushes an 'interp' frame so nextToken() resumes ordinary
  // tokenization, STR_PART), or EOF/newline (unterminated, L0003, same as a
  // plain string). `startOverride` lets the very first chunk's span begin at
  // the opening '"' — matching the old STR_LIT span exactly — while later
  // chunks (resumed after a hole) start fresh at the current position.
  private readStringChunk(startOverride?: Position): Token {
    const start = startOverride ?? this.c.mark();
    let value = '';
    while (true) {
      const ch = this.c.peek();
      if (ch === '\0' || ch === '\n') {
        this.modeStack.pop();
        return this.error('L0003', this.c.spanFrom(start));
      }
      if (ch === '"') {
        this.c.advance(); // consume closing '"'
        this.modeStack.pop();
        return { kind: 'STR_PART_END', value, span: this.c.spanFrom(start) };
      }
      if (ch === '$' && this.c.peek(1) === '{') {
        const interpStart = this.c.mark();
        this.c.match('${');
        this.modeStack.push({ kind: 'interp', depth: 0, start: interpStart });
        return { kind: 'STR_PART', value, span: this.c.spanFrom(start) };
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
          // '\$' escapes a literal '${' — without it the '$' would combine
          // with a following '{' to start a hole (design.md §4).
          case '$': value += '$'; break;
          default:
            this.modeStack.pop();
            return this.error('L0001', this.c.spanFrom(start));
        }
      } else {
        value += ch;
        this.c.advance();
      }
    }
  }

  // Scans one chunk of a multiline """..."""  string's *raw* text. Unlike
  // readStringChunk, it does NOT resolve escapes — a '\' plus the next
  // character is copied through undecoded — and a real newline is ordinary
  // content, not a stop condition (multiline text is expected to span
  // lines). Escape resolution and margin dedent both happen later, as a
  // pure pass over the collected raw chunks (src/parser/dedent.ts):
  // deferring escape resolution is what lets that pass tell a real source
  // newline apart from one produced by resolving a '\n' escape, using
  // nothing more than plain string operations — this scanner just needs to
  // still recognise an escaped quote/dollar well enough not to mistake it
  // for the closing '"""' or a hole.
  private readMultilineChunk(): Token {
    const start = this.c.mark();
    let value = '';
    while (true) {
      const ch = this.c.peek();
      if (ch === '\0') {
        const top = this.modeStack[this.modeStack.length - 1];
        const openStart = top !== undefined && top.kind === 'mstring' ? top.start : start;
        this.modeStack.pop();
        return this.error('L0007', this.c.spanFrom(openStart));
      }
      if (ch === '"' && this.c.peek(1) === '"' && this.c.peek(2) === '"') {
        const margin = this.c.mark().column - 1;
        this.c.match('"""');
        this.modeStack.pop();
        return { kind: 'MSTR_PART_END', value, span: this.c.spanFrom(start), dedentMargin: margin };
      }
      if (ch === '$' && this.c.peek(1) === '{') {
        const interpStart = this.c.mark();
        this.c.match('${');
        this.modeStack.push({ kind: 'interp', depth: 0, start: interpStart });
        return { kind: 'MSTR_PART', value, span: this.c.spanFrom(start) };
      }
      if (ch === '\\') {
        value += ch;
        this.c.advance();
        value += this.c.peek();
        this.c.advance();
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
    // While a 'string' frame is on top, we're mid-way through a "..." literal's
    // text — scan its next chunk instead of running the ordinary dispatch
    // below (which would wrongly skip whitespace/comments as trivia).
    const top = this.modeStack[this.modeStack.length - 1];
    if (top !== undefined && top.kind === 'string') {
      return this.readStringChunk();
    }
    if (top !== undefined && top.kind === 'mstring') {
      return this.readMultilineChunk();
    }

    this.skipTrivia();

    if (this.c.atEnd()) {
      // top, if present here, must be an 'interp' frame (a 'string' frame
      // would have returned above) whose '${' was never closed. Clear the
      // whole stack rather than popping just this frame: at true EOF there's
      // no more source left to legitimately re-tokenize, so any other frame
      // still underneath would only ever produce more of the same "also
      // reached EOF" noise, never a new fact worth a separate diagnostic.
      if (top !== undefined) {
        const span = this.c.spanFrom(top.start);
        this.modeStack = [];
        return this.error('L0006', span);
      }
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
      case '"':
        if (this.c.match('""')) {
          this.modeStack.push({ kind: 'mstring', start });
          return this.readMultilineChunk();
        }
        this.modeStack.push({ kind: 'string' });
        return this.readStringChunk(start);
      case '.': return this.token('DOT', start);
      case ':': return this.token('COLON', start);
      case ',': return this.token('COMMA', start);
      case ';': return this.token('SEMICOLON', start);
      case '(': return this.token('LPAREN', start);
      case ')': return this.token('RPAREN', start);
      case '{': {
        // Braces inside a '${ }' hole (an 'if' body, a block, …) nest one
        // level deeper than the hole itself, so the depth counter tracks
        // them — only the '}' back at depth 0 closes the hole (see '}' below).
        const cur = this.modeStack[this.modeStack.length - 1];
        if (cur !== undefined && cur.kind === 'interp') cur.depth++;
        return this.token('LBRACE', start);
      }
      case '}': {
        const cur = this.modeStack[this.modeStack.length - 1];
        if (cur !== undefined && cur.kind === 'interp') {
          if (cur.depth > 0) {
            cur.depth--;
            return this.token('RBRACE', start);
          }
          // This '}' closes the hole itself, not a nested block — swallow it
          // (same as the closing '"' is swallowed) and resume chunk-scanning
          // the string frame now back on top, without emitting a token for it.
          this.modeStack.pop();
          return this.nextToken();
        }
        return this.token('RBRACE', start);
      }
      case '[': return this.token('LBRACKET', start);
      case ']': return this.token('RBRACKET', start);
      case '?': return this.token('QUESTION', start);
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
