import type { Token } from './token.js';
import type { ErrorMarker } from './error-marker.js';
import type { Expr } from './ast.js';

export interface ParseResult {
  expr: Expr | null;
  errorMarkers: ErrorMarker[];
}

export class Parser {
  private tokens: Token[];
  private pos: number = 0;
  private errorMarkers: ErrorMarker[] = [];

  public constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // The lexer guarantees the last token is always EOF, so the fallback
  // is only reached if pos somehow exceeds the array — it never will.
  private peek(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    return this.tokens[this.pos++] ?? this.tokens[this.tokens.length - 1]!;
  }

  private parseExpr(): Expr | null {
    const tok = this.peek();

    if (tok.kind === 'INT_LIT') {
      this.advance();
      return {
        kind: 'Literal',
        value: BigInt(tok.value),
        span: tok.span
      };
    }

    this.errorMarkers.push({ code: 'S0002', span: tok.span });
    return null;
  }

  public parse(): ParseResult {
    const expr = this.parseExpr();
    return { expr, errorMarkers: this.errorMarkers };
  }
}
