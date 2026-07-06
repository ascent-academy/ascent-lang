// Approved

import type { Position, Span } from './token.js';

export class Cursor {
  private src: string;
  private pos: number = 0;
  private line: number = 1;
  private col: number = 1;

  public constructor(src: string) {
    this.src = src;
  }

  public peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '\0';
  }

  public advance(): string {
    const ch = this.src[this.pos++] ?? '\0';
    if (ch === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  public atEnd(): boolean {
    return this.pos >= this.src.length;
  }

  public mark(): Position {
    return { offset: this.pos, line: this.line, column: this.col };
  }

  public spanFrom(start: Position): Span {
    return { start, end: this.mark() };
  }

  // Consume `str` only if it appears verbatim at the cursor, e.g. match('"""').
  // Advances one char at a time so line/column bookkeeping stays correct.
  public match(str: string): boolean {
    if (!this.src.startsWith(str, this.pos)) {
      return false;
    }
    for (let i = 0; i < str.length; i++) {
      this.advance();
    }
    return true;
  }

  public slice(start: Position): string {
    return this.src.slice(start.offset, this.pos);
  }
}
