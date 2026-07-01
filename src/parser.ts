import type { Token, TokenKind } from './token.js';
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
  // tightly it grabs its operands. Higher binds tighter — that's what
  // encodes precedence: '*' outbinds '+', so `1 + 2 * 3` parses as
  // `1 + (2 * 3)`, not `(1 + 2) * 3`. The parsing loop only accepts an
  // operator when its binding power is at least `minBp` — the "how
  // tight does the *caller* need things bound" threshold passed down on
  // each recursive call.
  //
  // Every operator this parser knows about has one row in this table.
  // Adding the next one (say '-') means adding a row, never touching
  // the loop below.
  private static readonly INFIX_OPS: Partial<Record<TokenKind, { op: '+' | '*'; bp: number }>> = {
    PLUS: { op: '+', bp: 1 },
    STAR: { op: '*', bp: 2 },
  };

  private parseExpr(minBp = 0): Expr | null {
    let left = this.parseAtom();
    if (left === null) {
      return null;
    }

    while (true) {
      const infix = Parser.INFIX_OPS[this.peek().kind];
      if (infix === undefined || infix.bp < minBp) {
        break;
      }
      this.advance(); // consume the operator

      // Left-associativity — `1 + 2 + 3` must parse as `(1 + 2) + 3`,
      // not `1 + (2 + 3)`. Parsing the right-hand side with `bp + 1`
      // (instead of `bp`) is what enforces that: it stops a second '+'
      // from being absorbed into the *right* operand, forcing it to
      // instead be picked up by the loop one level up.
      const right = this.parseExpr(infix.bp + 1);
      if (right === null) {
        return null;
      }

      left = {
        kind: 'binary',
        op: infix.op,
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
