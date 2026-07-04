// parser.ts — Stage 1 recursive-descent / Pratt parser.
//
// Grammar covered here:
//   program  = stmt*
//   stmt     = fix-decl | mut-decl | assign | expr-stmt
//   fix-decl = 'fix' IDENT '=' expr ';'
//   mut-decl = 'mut' IDENT '=' expr ';'
//   assign   = IDENT '=' expr ';'          (IDENT followed by '=', not '==')
//   expr-stmt= expr ';'
//
// Expressions use Pratt parsing.
// Binding powers (design.md §5, loosest → tightest):
//   or(2)  and(4)  not-prefix(5)  cmp(6)  +-(8)  */div(10)  neg-prefix(11)  atom

import type { Token, TokenKind } from './token.js';
import type { Span, Position, RawDiagnostic } from './diagnostic.js';
import type { Expr, Stmt, BinaryOp, Program } from './ast.js';

export interface ParseResult {
  program: Program;
  diagnostics: RawDiagnostic[];
}

export class Parser {
  private pos = 0;
  private readonly diagnostics: RawDiagnostic[] = [];

  constructor(private readonly tokens: Token[]) {}

  parse(): ParseResult {
    const stmts: Stmt[] = [];
    while (!this.at('EOF')) {
      const stmt = this.parseStmt();
      if (stmt !== null) stmts.push(stmt);
    }
    return { program: { stmts }, diagnostics: this.diagnostics };
  }

  // ── token navigation ───────────────────────────────────────────────────────

  private peek(offset = 0): Token {
    const idx = this.pos + offset;
    // Clamp to last token (always EOF) so callers never get undefined.
    return this.tokens[Math.min(idx, this.tokens.length - 1)] as Token;
  }

  private at(kind: TokenKind, offset = 0): boolean {
    return this.peek(offset).kind === kind;
  }

  private advance(): Token {
    const tok = this.tokens[this.pos] as Token;
    if (tok.kind !== 'EOF') this.pos++;
    return tok;
  }

  private eat(kind: TokenKind): Token | null {
    if (this.at(kind)) return this.advance();
    return null;
  }

  // Consume `kind` or emit `code` at the current token and return null.
  private expect(kind: TokenKind, code: string, data?: Record<string, unknown>): Token | null {
    if (this.at(kind)) return this.advance();
    this.emitDiag(code, this.peek().span, data);
    return null;
  }

  // ── diagnostics ────────────────────────────────────────────────────────────

  private emitDiag(code: string, span: Span, data?: Record<string, unknown>): void {
    this.diagnostics.push(data ? { code, span, data } : { code, span });
  }

  // ── error recovery ─────────────────────────────────────────────────────────

  // Skip tokens until ';' or EOF, then consume the ';'.
  private syncToSemicolon(): void {
    while (!this.at('EOF') && !this.at('SEMICOLON')) this.advance();
    this.eat('SEMICOLON');
  }

  // ── statement parser ───────────────────────────────────────────────────────

  private parseStmt(): Stmt | null {
    // fix <name> = <expr> ;
    if (this.at('KW_FIX')) {
      const kw = this.advance();
      const name = this.expect('IDENT', 'S0005');
      if (name === null) { this.syncToSemicolon(); return null; }
      if (this.expect('EQ', 'S0001', { expected: '=' }) === null) { this.syncToSemicolon(); return null; }
      const value = this.parseExpr(0);
      if (value === null) { this.syncToSemicolon(); return null; }
      const semi = this.expect('SEMICOLON', 'S0003');
      if (semi === null) { this.syncToSemicolon(); return null; }
      return { kind: 'fix', name: name.value, nameSpan: name.span, value, span: between(kw.span.start, semi.span.end) };
    }

    // mut <name> = <expr> ;
    if (this.at('KW_MUT')) {
      const kw = this.advance();
      const name = this.expect('IDENT', 'S0005');
      if (name === null) { this.syncToSemicolon(); return null; }
      if (this.expect('EQ', 'S0001', { expected: '=' }) === null) { this.syncToSemicolon(); return null; }
      const value = this.parseExpr(0);
      if (value === null) { this.syncToSemicolon(); return null; }
      const semi = this.expect('SEMICOLON', 'S0003');
      if (semi === null) { this.syncToSemicolon(); return null; }
      return { kind: 'mut', name: name.value, nameSpan: name.span, value, span: between(kw.span.start, semi.span.end) };
    }

    // <name> = <expr> ;   (assignment — IDENT followed by '=', not '==')
    if (this.at('IDENT') && this.at('EQ', 1)) {
      const name = this.advance();
      this.advance(); // '='
      const value = this.parseExpr(0);
      if (value === null) { this.syncToSemicolon(); return null; }
      const semi = this.expect('SEMICOLON', 'S0003');
      if (semi === null) { this.syncToSemicolon(); return null; }
      return { kind: 'assign', name: name.value, nameSpan: name.span, value, span: between(name.span.start, semi.span.end) };
    }

    // <expr> ;
    const expr = this.parseExpr(0);
    if (expr === null) { this.syncToSemicolon(); return null; }
    const semi = this.expect('SEMICOLON', 'S0003');
    if (semi === null) { this.syncToSemicolon(); return null; }
    return { kind: 'expr', expr, span: between(expr.span.start, semi.span.end) };
  }

  // ── expression parser (Pratt) ──────────────────────────────────────────────

  // Left binding power: how strongly an infix operator grabs the left operand.
  // Operators not listed (';', ')', EOF, …) return 0 — the loop stops.
  private lbp(tok: Token): number {
    switch (tok.kind) {
      case 'KW_OR':                                              return 2;
      case 'KW_AND':                                            return 4;
      case 'EQ_EQ': case 'BANG_EQ':
      case 'LT': case 'LT_EQ': case 'GT': case 'GT_EQ':       return 6;
      case 'PLUS': case 'MINUS':                                return 8;
      case 'STAR': case 'SLASH': case 'KW_DIV':                return 10;
      default:                                                  return 0;
    }
  }

  private parseExpr(minBP: number): Expr | null {
    let left = this.parsePrefix();
    if (left === null) return null;

    while (true) {
      const opTok = this.peek();
      const bp = this.lbp(opTok);
      if (bp <= minBP) break;

      this.advance(); // consume the infix operator

      // Comparisons use rbp = bp + 1 so the same operator can't re-bind on the
      // right, making `a == b == c` parse as `(a == b) == c` (left-assoc for
      // now; the type checker will reject chained comparisons).
      // All others are left-assoc: recurse with the same bp.
      const rbp = isComparison(opTok.kind) ? bp + 1 : bp;

      const right = this.parseExpr(rbp);
      if (right === null) return null;

      left = {
        kind: 'binary',
        op: infixOp(opTok.kind),
        left, right,
        span: between(left.span.start, right.span.end),
      };
    }

    return left;
  }

  private parsePrefix(): Expr | null {
    const tok = this.peek();

    // Unary 'not' — rbp=5, sits between 'and'(4) and comparisons(6).
    // 'not a == b' → 'not (a == b)'; 'not a and b' → '(not a) and b'.
    if (tok.kind === 'KW_NOT') {
      this.advance();
      const operand = this.parseExpr(5);
      if (operand === null) return null;
      return { kind: 'unary', op: 'not', operand, span: between(tok.span.start, operand.span.end) };
    }

    // Unary '-' — rbp=11, tighter than '*/div'(10), so '-a * b' → '(-a) * b'.
    if (tok.kind === 'MINUS') {
      this.advance();
      const operand = this.parseExpr(11);
      if (operand === null) return null;
      return { kind: 'unary', op: 'neg', operand, span: between(tok.span.start, operand.span.end) };
    }

    // Grouped expression: '(' expr ')'
    if (tok.kind === 'LPAREN') {
      this.advance();
      const expr = this.parseExpr(0);
      if (expr === null) { this.eat('RPAREN'); return null; }
      if (this.expect('RPAREN', 'S0004') === null) return null;
      return expr; // the grouped span is the inner expr's span (parens are transparent)
    }

    return this.parseAtom();
  }

  private parseAtom(): Expr | null {
    const tok = this.peek();
    switch (tok.kind) {
      case 'INT_LIT':
        this.advance();
        return { kind: 'int', value: BigInt(tok.value), span: tok.span };
      case 'FLOAT_LIT':
        this.advance();
        return { kind: 'float', value: Number(tok.value), span: tok.span };
      case 'BOOL_LIT':
        this.advance();
        return { kind: 'bool', value: tok.value === 'true', span: tok.span };
      case 'STRING_LIT':
        this.advance();
        return { kind: 'string', value: tok.value, span: tok.span };
      case 'IDENT':
        this.advance();
        return { kind: 'name', name: tok.value, span: tok.span };
      case 'ERROR':
        // Lexer already emitted a diagnostic; leave token for sync.
        return null;
      default:
        this.emitDiag('S0002', tok.span);
        return null;
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function between(start: Position, end: Position): Span {
  return { start, end };
}

function isComparison(kind: TokenKind): boolean {
  return kind === 'EQ_EQ' || kind === 'BANG_EQ' ||
    kind === 'LT' || kind === 'LT_EQ' || kind === 'GT' || kind === 'GT_EQ';
}

function infixOp(kind: TokenKind): BinaryOp {
  switch (kind) {
    case 'KW_OR':   return 'or';
    case 'KW_AND':  return 'and';
    case 'EQ_EQ':   return 'eq';
    case 'BANG_EQ': return 'neq';
    case 'LT':      return 'lt';
    case 'LT_EQ':   return 'lte';
    case 'GT':      return 'gt';
    case 'GT_EQ':   return 'gte';
    case 'PLUS':    return 'add';
    case 'MINUS':   return 'sub';
    case 'STAR':    return 'mul';
    case 'SLASH':   return 'divFloat';
    case 'KW_DIV':  return 'divInt';
    default:        throw new Error(`Not an infix operator: ${kind}`);
  }
}
