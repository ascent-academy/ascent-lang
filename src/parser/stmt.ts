import type { Token } from '../lexer/token.js';
import type { Expr, Statement, Block, If, TypeExpr } from './ast.js';
import type { TokenStream } from './token-stream.js';
import { parseExpr } from './expr.js';
import { parseTypeExpr } from './type-expr.js';

// A block is '{' stmt* '}', each statement separated by ';' — the
// same "item (sep item)* close" shape as a call's args or a list
// literal, just with SEMICOLON as the separator and RBRACE as the
// close (§ design.md: "semicolons terminate every statement"; the
// trailing one is optional exactly like a list's trailing comma).
// `openTok` lets parseRequiredBlock pass in a '{' it already consumed
// via `expect`; parseAtom, which hasn't consumed one, omits it and
// this consumes its own.
export function parseBlock(ts: TokenStream, openTok?: Token): Block | null {
  openTok ??= ts.advance(); // consume '{' unless already consumed
  const parsed = ts.parseSeparated(() => parseStmt(ts), 'SEMICOLON', 'RBRACE', 'S0005', true, openTok.span);
  if (parsed === null) return null;

  return { kind: 'block', stmts: parsed.items, span: { start: openTok.span.start, end: parsed.close.span.end } };
}

// The parenthesized test shared by 'if' and 'while' — '(' expr ')'.
// The body braces already delimit the construct, but the test stays
// parenthesized to match the C-family/TS surface (§5).
function parseCond(ts: TokenStream): Expr | null {
  const open = ts.expect('LPAREN', 'S0006');
  if (open === null) return null;

  const cond = parseExpr(ts);
  if (cond === null) {
    return null;
  }

  if (ts.expect('RPAREN', 'S0001', [{ key: 'opener', span: open.span }]) === null) return null;

  return cond;
}

// A mandatory body block — every 'if'/'while' branch needs one, even
// single-statement (§2: no dangling-else, no goto-fail class of bug).
function parseRequiredBlock(ts: TokenStream): Block | null {
  const openTok = ts.expect('LBRACE', 'S0007');
  if (openTok === null) return null;
  return parseBlock(ts, openTok);
}

// 'if (cond) { } else if (cond) { } else { }' — 'else if' is not its
// own grammar rule, it's an If recursively parsed as the else branch.
// It's an expression (see parseAtom), but it clusters with the other
// braced control constructs, so it lives here beside 'while'.
export function parseIf(ts: TokenStream): If | null {
  const ifTok = ts.advance(); // consume 'if'

  const cond = parseCond(ts);
  if (cond === null) {
    return null;
  }

  const thenBlock = parseRequiredBlock(ts);
  if (thenBlock === null) {
    return null;
  }

  let elseBranch: Block | If | null = null;
  if (ts.peek().kind === 'KW_ELSE') {
    ts.advance(); // consume 'else'
    elseBranch = ts.peek().kind === 'KW_IF' ? parseIf(ts) : parseRequiredBlock(ts);
    if (elseBranch === null) {
      return null;
    }
  }

  return {
    kind: 'if',
    cond,
    then: thenBlock,
    else: elseBranch,
    span: { start: ifTok.span.start, end: (elseBranch ?? thenBlock).span.end },
  };
}

// 'while (cond) { }' — a statement, not an expression (§5): a loop has
// no single meaningful result, so it isn't usable where a value is
// expected the way 'if' is.
function parseWhile(ts: TokenStream): Statement | null {
  const whileTok = ts.advance(); // consume 'while'

  const cond = parseCond(ts);
  if (cond === null) {
    return null;
  }

  const body = parseRequiredBlock(ts);
  if (body === null) {
    return null;
  }

  return { kind: 'while', cond, body, span: { start: whileTok.span.start, end: body.span.end } };
}

// 'fix' and 'mut' share every rule but the keyword itself and the
// mutability it grants — one parse method, told which by 'kind'.
function parseDecl(ts: TokenStream, kind: 'fix' | 'mut'): Statement | null {
  const kwTok = ts.advance(); // consume 'fix' or 'mut'

  const nameTok = ts.peek();
  if (nameTok.kind !== 'SLOT') {
    ts.report('S0003', nameTok.span);
    return null;
  }
  ts.advance(); // consume slot name

  let typeAnnotation: TypeExpr | null = null;
  if (ts.peek().kind === 'COLON') {
    ts.advance(); // consume ':'
    typeAnnotation = parseTypeExpr(ts);
    if (typeAnnotation === null) return null;
  }

  if (ts.expect('EQUALS', 'S0004') === null) return null;

  const init = parseExpr(ts);
  if (init === null) {
    return null;
  }

  return {
    kind,
    name: nameTok.value,
    typeAnnotation,
    init,
    span: { start: kwTok.span.start, end: init.span.end },
  };
}

// 'name = expr;' — reassigns a slot already declared with 'fix' or
// 'mut'. Whether that's actually allowed (the slot must be 'mut') is
// a name-binding rule, not a grammar rule, so it's checked at
// evaluation time (interpreter.ts), not here.
function parseAssign(ts: TokenStream): Statement | null {
  const nameTok = ts.advance(); // consume slot name
  ts.advance(); // consume '='

  const value = parseExpr(ts);
  if (value === null) {
    return null;
  }

  return {
    kind: 'assign',
    name: nameTok.value,
    nameSpan: nameTok.span,
    value,
    span: { start: nameTok.span.start, end: value.span.end },
  };
}

export function parseStmt(ts: TokenStream): Statement | null {
  if (ts.peek().kind === 'KW_FIX') {
    return parseDecl(ts, 'fix');
  }
  if (ts.peek().kind === 'KW_MUT') {
    return parseDecl(ts, 'mut');
  }
  if (ts.peek().kind === 'KW_WHILE') {
    return parseWhile(ts);
  }
  if (ts.peek().kind === 'SLOT' && ts.peekNext().kind === 'EQUALS') {
    return parseAssign(ts);
  }

  const expr = parseExpr(ts);
  if (expr === null) {
    return null;
  }
  return { kind: 'expr', expr, span: expr.span };
}
