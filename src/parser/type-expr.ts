import type { TypeExpr, ArgDef, ArgType } from './ast.js';
import type { TokenStream } from './token-stream.js';

// 'Int', 'Float', 'Bool', 'String', or 'List<Type>' — used in type annotations.
export function parseTypeExpr(ts: TokenStream): TypeExpr | null {
  const tok = ts.peek();
  if (tok.kind !== 'TYPE_NAME') {
    ts.report('S0010', tok.span);
    return null;
  }
  ts.advance(); // consume type name

  if (tok.value === 'List') {
    if (ts.expect('LT', 'S0010') === null) return null;

    const elem = parseTypeExpr(ts);
    if (elem === null) return null;

    const gt = ts.expect('GT', 'S0010');
    if (gt === null) return null;

    return { kind: 'ListType', elem, span: { start: tok.span.start, end: gt.span.end } };
  }

  const name = tok.value as 'Int' | 'Float' | 'Bool' | 'String';
  return { kind: 'TypeName', name, span: tok.span };
}

// 'name: Type' — one entry in an args declaration. Unlike a slot's type
// annotation this only allows a bare type name (no 'List<…>'), so it
// reads the TYPE_NAME token directly rather than going through
// parseTypeExpr.
function parseArgDef(ts: TokenStream): ArgDef | null {
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

// 'args (name: Type, …)' — the program's typed input declaration.
export function parseArgs(ts: TokenStream): ArgDef[] | null {
  ts.advance(); // consume 'args'

  if (ts.expect('LPAREN', 'S0006') === null) return null;

  const parsed = ts.parseSeparated(() => parseArgDef(ts), 'COMMA', 'RPAREN', 'S0001');
  if (parsed === null) return null;

  return parsed.items;
}
