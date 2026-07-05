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
    const name = tok.value as 'Int' | 'Float' | 'Bool' | 'String';
    base = { kind: 'TypeName', name, span: tok.span };
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

// 'name: Type' — one entry in an args declaration. Unlike a slot's type
// annotation this only allows a bare type name (no 'List<…>'), so it
// reads the TYPE_NAME token directly rather than going through
// parseTypeExpr.
function parseArgDef(ts: TokenStream): ProgramArg | null {
  const nameTok = ts.peek();
  if (nameTok.kind !== 'SLOT') {
    ts.report('S0003', nameTok.span);
    return null;
  }
  ts.advance(); // consume name

  if (ts.expect('COLON', 'S0009') === null) return null;

  const typeTok = ts.peek();
  if (typeTok.kind !== 'TYPE_NAME') {
    ts.report('S0010', typeTok.span);
    return null;
  }
  ts.advance(); // consume type name

  return { name: nameTok.value, type: typeTok.value as ArgType };
}

// 'args (name: Type, …) ;' — the program's typed input declaration, if
// present. Returns [] (not null) when there's no 'args' keyword at all;
// null is reserved for an actual parse error.
export function parseArgsSection(ts: TokenStream): ProgramArg[] | null {
  if (ts.peek().kind !== 'KW_ARGS') return [];
  ts.advance(); // consume 'args'

  const open = ts.expect('LPAREN', 'S0006');
  if (open === null) return null;

  const parsed = ts.parseSeparated(() => parseArgDef(ts), 'COMMA', 'RPAREN', 'S0001', false, open.span);
  if (parsed === null) return null;

  if (ts.expect('SEMICOLON', 'S0011') === null) return null;

  return parsed.items;
}
