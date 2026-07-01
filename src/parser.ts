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

  // ---- Pratt parsing --------------------------------------------------
  //
  // A Pratt parser recognises an expression as an atom (a "nud" — null
  // denotation, a value that doesn't look left at anything) optionally
  // followed by a chain of infix operators (each a "led" — left
  // denotation, because it combines the value already parsed with
  // whatever comes after it).
  //
  // Every infix operator has a binding power: a number saying how
  // tightly it grabs its operands. The parsing loop below only accepts
  // an operator when its binding power is at least `minBp` — the
  // "how tight does the *caller* need things bound" threshold that gets
  // passed down on each recursive call. With a single operator this
  // machinery looks like overkill, but it's the exact shape that scales:
  // adding `-`, `*`, `/` later means adding rows to a table, not
  // rewriting the loop.

  // '+' is left-associative: `1 + 2 + 3` must parse as `(1 + 2) + 3`,
  // not `1 + (2 + 3)`. Parsing the right-hand side with `PLUS_BP + 1`
  // (instead of `PLUS_BP`) is what enforces that — it stops the second
  // '+' from being absorbed into the *right* operand, forcing it to
  // instead be picked up by the loop one level up.
  private static readonly PLUS_BP = 1;

  private parseExpr(minBp = 0): Expr | null {
    let left = this.parseAtom();
    if (left === null) {
      return null;
    }

    while (this.peek().kind === 'PLUS' && Parser.PLUS_BP >= minBp) {
      this.advance(); // consume '+'

      const right = this.parseExpr(Parser.PLUS_BP + 1);
      if (right === null) {
        return null;
      }

      left = {
        kind: 'binary',
        op: '+',
        left,
        right,
        span: { start: left.span.start, end: right.span.end }
      };
    }

    return left;
  }

  // parseAtom parses the smallest possible expression: a single literal
  // that doesn't depend on any operator. This is the Pratt parser's nud —
  // every future one (parenthesized groups, unary '-', identifiers) is
  // just another case added here, never a change to the loop above.
  private parseAtom(): Expr | null {
    const tok = this.peek();

    if (tok.kind === 'INT_LIT') {
      this.advance();
      return {
        kind: 'int',
        value: BigInt(tok.value),
        span: tok.span
      };
    }

    if (tok.kind === 'FLOAT_LIT') {
      this.advance();
      return {
        kind: 'float',
        value: parseFloat(tok.value),
        span: tok.span
      };
    }

    if (tok.kind === 'BOOL_LIT') {
      this.advance();
      return {
        kind: 'bool',
        value: tok.value === 'true',
        span: tok.span
      };
    }

    if (tok.kind === 'NONE_LIT') {
      this.advance();
      return {
        kind: 'none',
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
