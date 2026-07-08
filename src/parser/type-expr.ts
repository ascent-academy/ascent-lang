import type { TypeExpr, FnParam, ProgramArg, ArgType } from './ast.js';
import type { TokenStream } from './token-stream.js';

// 'fn(T, T) -> R' — a function type in annotation position (whitepaper §5/§7).
// The 'fn' is already confirmed on lookahead by parseTypeExpr. Positional
// parameter types (no names), then '->' and the required result type. Zero
// parameters ('fn() -> Done') are fine, the same as a zero-input program.
function parseFnType(ts: TokenStream): TypeExpr | null {
  const fnTok = ts.advance(); // consume 'fn'

  const open = ts.expect('LPAREN', 'S0006');
  if (open === null) return null;

  const parsed = ts.parseSeparated(() => parseTypeExpr(ts), 'COMMA', 'RPAREN', 'S0001', false, open.span);
  if (parsed === null) return null;

  if (ts.expect('ARROW', 'S0031') === null) return null;

  const result = parseTypeExpr(ts);
  if (result === null) return null;

  return { kind: 'FnType', params: parsed.items, result, span: { start: fnTok.span.start, end: result.span.end } };
}

// 'Int', 'Float', 'Bool', 'String', 'List<Type>', 'fn(T) -> R', or any of those
// followed by a trailing '?' (sugar for 'Optional<Type>', design.md §4) — used
// in type annotations.
export function parseTypeExpr(ts: TokenStream): TypeExpr | null {
  const tok = ts.peek();

  let base: TypeExpr;
  if (tok.kind === 'KW_FN') {
    const fnType = parseFnType(ts);
    if (fnType === null) return null;
    base = fnType;
  } else if (tok.kind === 'DONE_LIT') {
    // 'Done' is the unit *type* here (a function's return type when it produces
    // no information — whitepaper §4), even though the same word is a value
    // constructor elsewhere. Position tells them apart (design.md §2): after ':'
    // or '->' it's a type. It lexes as DONE_LIT, not TYPE_NAME, so it's admitted
    // explicitly and carried as the 'Done' type name for formation to resolve.
    ts.advance(); // consume 'Done'
    base = { kind: 'TypeName', name: 'Done', span: tok.span };
  } else if (tok.kind !== 'TYPE_NAME') {
    ts.report('S0010', tok.span);
    return null;
  } else if (tok.value === 'List') {
    ts.advance(); // consume 'List'
    if (ts.expect('LT', 'S0010') === null) return null;

    const elem = parseTypeExpr(ts);
    if (elem === null) return null;

    const gt = ts.expect('GT', 'S0010');
    if (gt === null) return null;

    base = { kind: 'ListType', elem, span: { start: tok.span.start, end: gt.span.end } };
  } else {
    ts.advance(); // consume type name
    // Any other TYPE_NAME — a built-in scalar or a user-declared type. Whether
    // the name actually names a declared type is a formation-time check
    // (src/check/formation.ts), not the parser's job.
    base = { kind: 'TypeName', name: tok.value, span: tok.span };
  }

  // A trailing '?' wraps whatever came before it — 'String?', 'List<Int>?' —
  // and stacks if repeated ('String??' is Optional<Optional<String>>, an odd
  // but harmless type, not a special error).
  while (ts.peek().kind === 'QUESTION') {
    const q = ts.advance();
    base = { kind: 'OptionalType', elem: base, span: { start: base.span.start, end: q.span.end } };
  }

  return base;
}

// 'name: Type' — one parameter in a 'program (…)' input list. Unlike a slot's
// type annotation this only allows a bare type name (no 'List<…>'), so it
// reads the TYPE_NAME token directly rather than going through parseTypeExpr.
export function parseParam(ts: TokenStream): ProgramArg | null {
  const nameTok = ts.peek();
  if (nameTok.kind !== 'SLOT') {
    ts.report('S0003', nameTok.span);
    return null;
  }
  ts.advance(); // consume name

  if (ts.expect('COLON', 'S0009') === null) return null;

  // A program input admits only the four scalars (whitepaper §11 — a structured
  // value has no single input widget). Now that every UpperCamel name lexes as a
  // TYPE_NAME, 'List' and user types reach here too, so the scalar set is
  // checked explicitly rather than trusting the token kind.
  const typeTok = ts.peek();
  const ARG_SCALARS = ['Int', 'Float', 'Bool', 'String'];
  if (typeTok.kind !== 'TYPE_NAME' || !ARG_SCALARS.includes(typeTok.value)) {
    ts.report('S0010', typeTok.span);
    return null;
  }
  ts.advance(); // consume type name

  return { name: nameTok.value, type: typeTok.value as ArgType };
}

// 'name: Type' — one parameter of an 'fn' literal (whitepaper §5). Unlike a
// program input (parseParam above, scalar-only), a function parameter admits
// any type, so the type is a full parseTypeExpr — 'List<Int>', a user type,
// 'Int?', or another 'fn(...) -> ...'.
export function parseFnParam(ts: TokenStream): FnParam | null {
  const nameTok = ts.peek();
  if (nameTok.kind !== 'SLOT') {
    ts.report('S0003', nameTok.span);
    return null;
  }
  ts.advance(); // consume name

  if (ts.expect('COLON', 'S0009') === null) return null;

  const type = parseTypeExpr(ts);
  if (type === null) return null;

  return { name: nameTok.value, nameSpan: nameTok.span, type, span: { start: nameTok.span.start, end: type.span.end } };
}
