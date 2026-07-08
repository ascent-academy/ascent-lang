import type { TypeExpr, ProgramArg, ArgType } from './ast.js';
import type { TokenStream } from './token-stream.js';

// 'Int', 'Float', 'Bool', 'String', 'List<Type>', or any of those followed by
// a trailing '?' (sugar for 'Optional<Type>', design.md §4) — used in type
// annotations.
export function parseTypeExpr(ts: TokenStream): TypeExpr | null {
  const tok = ts.peek();
  if (tok.kind !== 'TYPE_NAME') {
    ts.report('S0010', tok.span);
    return null;
  }
  ts.advance(); // consume type name

  let base: TypeExpr;
  if (tok.value === 'List') {
    if (ts.expect('LT', 'S0010') === null) return null;

    const elem = parseTypeExpr(ts);
    if (elem === null) return null;

    const gt = ts.expect('GT', 'S0010');
    if (gt === null) return null;

    base = { kind: 'ListType', elem, span: { start: tok.span.start, end: gt.span.end } };
  } else {
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
