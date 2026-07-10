import type { TypeExpr, FnParam, ProgramArg, ArgType } from './ast.js';
import type { TokenStream } from './token-stream.js';

// 'Fn(T, T) -> R' — a function type in annotation position (whitepaper §5/§7).
// Capitalized because it is a *type* (UpperCamel, like 'List'/'Optional'), and
// it keeps the '->' arrow — the colon is the *value* literal's return separator
// ('fn(x: T): R'), the arrow the *type*'s, so nested higher-order signatures
// stay legible. The 'Fn' is already confirmed on lookahead by parseTypeExpr;
// it lexes as a plain TYPE_NAME. Positional parameter types (no names), then
// '->' and the required result type. Zero parameters ('Fn() -> Done') are fine,
// the same as a zero-input program.
function parseFnType(ts: TokenStream): TypeExpr | null {
  const fnTok = ts.advance(); // consume 'Fn'

  const open = ts.expect('LPAREN', 'S0010');
  if (open === null) return null;

  const parsed = ts.parseSeparated(() => parseTypeExpr(ts), 'COMMA', 'RPAREN', 'S0001', false, open.span);
  if (parsed === null) return null;

  if (ts.expect('ARROW', 'S0025') === null) return null;

  const result = parseTypeExpr(ts);
  if (result === null) return null;

  return { kind: 'FnType', params: parsed.items, result, span: { start: fnTok.span.start, end: result.span.end } };
}

// 'Int', 'Float', 'Bool', 'String', 'List<Type>', 'Fn(T) -> R', or any of those
// followed by a trailing '?' (sugar for 'Optional<Type>', design.md §4) — used
// in type annotations. This is the tight level, below the loose 'orfail' infix
// (parseTypeExpr), so 'Int orfail E?' groups as 'Int orfail (E?)' — the '?' binds
// to its own operand, not the whole Result.
function parsePostfixType(ts: TokenStream): TypeExpr | null {
  const tok = ts.peek();

  let base: TypeExpr;
  if (tok.kind === 'LPAREN') {
    // A parenthesized group — pure precedence grouping, so that a loose 'orfail'
    // can sit under a tighter operator: '(Int orfail String)?' is an Optional of
    // a Result (which the bare 'Int orfail String?' can't spell — that binds the
    // '?' to 'String'). The parens carry no node of their own; the inner type is
    // returned directly, and any trailing '?' below then applies to it.
    ts.advance(); // consume '('
    const inner = parseTypeExpr(ts);
    if (inner === null) return null;
    if (ts.expect('RPAREN', 'S0001', [{ key: 'opener', span: tok.span }]) === null) return null;
    base = inner;
  } else if (tok.kind === 'DONE_LIT') {
    // 'Done' is the unit *type* here (a function's return type when it produces
    // no information — whitepaper §4), even though the same word is a value
    // constructor elsewhere. Position tells them apart (design.md §2): after ':'
    // or '->' it's a type. It lexes as DONE_LIT, not TYPE_NAME, so it's admitted
    // explicitly and carried as the 'Done' type name for formation to resolve.
    ts.advance(); // consume 'Done'
    base = { kind: 'TypeName', name: 'Done', span: tok.span };
  } else if (tok.kind !== 'TYPE_NAME') {
    ts.report('S0012', tok.span);
    return null;
  } else if (tok.value === 'Fn') {
    // 'Fn(...) -> R' — a function type. Like 'List', it lexes as a plain
    // TYPE_NAME whose text happens to be a reserved built-in type name.
    const fnType = parseFnType(ts);
    if (fnType === null) return null;
    base = fnType;
  } else if (tok.value === 'List') {
    ts.advance(); // consume 'List'
    if (ts.expect('LT', 'S0012') === null) return null;

    const elem = parseTypeExpr(ts);
    if (elem === null) return null;

    const gt = ts.expect('GT', 'S0012');
    if (gt === null) return null;

    base = { kind: 'ListType', elem, span: { start: tok.span.start, end: gt.span.end } };
  } else if (tok.value === 'Task') {
    // 'Task<T>' — the inert result of an async call (whitepaper §8). Same
    // angle-bracket shape as 'List<T>'; the element is the awaited result type.
    ts.advance(); // consume 'Task'
    if (ts.expect('LT', 'S0012') === null) return null;

    const elem = parseTypeExpr(ts);
    if (elem === null) return null;

    const gt = ts.expect('GT', 'S0012');
    if (gt === null) return null;

    base = { kind: 'TaskType', elem, span: { start: tok.span.start, end: gt.span.end } };
  } else {
    ts.advance(); // consume type name
    // Any other TYPE_NAME — a built-in scalar or a user-declared type. Whether
    // the name actually names a declared type is a formation-time check
    // (src/check/formation.ts), not the parser's job.
    base = { kind: 'TypeName', name: tok.value, span: tok.span };
  }

  // A trailing '?' wraps whatever came before it — 'String?', 'List<Int>?'. A
  // repeated '?' ('String??') or a '?' on an already-optional group ('(String?)?')
  // stacks into nested OptionalType nodes here; formation (src/check/formation.ts)
  // then reports the redundant '?' (T0047) and collapses it, since Optional never
  // nests (§4/§7). Keeping the nested nodes is what lets formation *see* the
  // redundancy — collapsing it in the parser would hide the mistake. Adjacent
  // '??' lexes as one QUESTION_QUESTION (the value-level coalesce operator), but
  // in type position it can only be two optional marks, so it counts as two wraps.
  while (ts.peek().kind === 'QUESTION' || ts.peek().kind === 'QUESTION_QUESTION') {
    const q = ts.advance();
    const marks = q.kind === 'QUESTION_QUESTION' ? 2 : 1;
    for (let i = 0; i < marks; i++) {
      base = { kind: 'OptionalType', elem: base, span: { start: base.span.start, end: q.span.end } };
    }
  }

  return base;
}

// A full type annotation: a postfix type, optionally followed by 'orfail E' to
// form a Result (whitepaper §9). 'orfail' is the loosest type operator, so it
// sits above the '?' postfix and everything below. A single 'orfail' only — the
// error side is itself a postfix type, not another 'orfail' (Result-of-Result
// isn't a spelling anyone needs), so 'A orfail B orfail C' is a syntax error at
// the second 'orfail' rather than a silently-nested type.
export function parseTypeExpr(ts: TokenStream): TypeExpr | null {
  const ok = parsePostfixType(ts);
  if (ok === null) return null;

  if (ts.peek().kind !== 'KW_ORFAIL') return ok;
  ts.advance(); // consume 'orfail'

  const err = parsePostfixType(ts);
  if (err === null) return null;

  return { kind: 'ResultType', ok, err, span: { start: ok.span.start, end: err.span.end } };
}

// 'name: Type' — one parameter in a 'program (…)' input list. Unlike a slot's
// type annotation this only allows a bare type name (no 'List<…>'), so it
// reads the TYPE_NAME token directly rather than going through parseTypeExpr.
export function parseParam(ts: TokenStream): ProgramArg | null {
  const nameTok = ts.peek();
  if (nameTok.kind !== 'SLOT') {
    ts.report('S0007', nameTok.span);
    return null;
  }
  ts.advance(); // consume name

  if (ts.expect('COLON', 'S0011') === null) return null;

  // A program input admits only the four scalars (whitepaper §11 — a structured
  // value has no single input widget). Now that every UpperCamel name lexes as a
  // TYPE_NAME, 'List' and user types reach here too, so the scalar set is
  // checked explicitly rather than trusting the token kind.
  const typeTok = ts.peek();
  const ARG_SCALARS = ['Int', 'Float', 'Bool', 'String'];
  if (typeTok.kind !== 'TYPE_NAME' || !ARG_SCALARS.includes(typeTok.value)) {
    ts.report('S0012', typeTok.span);
    return null;
  }
  ts.advance(); // consume type name

  return { name: nameTok.value, type: typeTok.value as ArgType };
}

// 'name: Type' — one parameter of an 'fn' literal (whitepaper §5). Unlike a
// program input (parseParam above, scalar-only), a function parameter admits
// any type, so the type is a full parseTypeExpr — 'List<Int>', a user type,
// 'Int?', or another 'Fn(...) -> ...'.
export function parseFnParam(ts: TokenStream): FnParam | null {
  const nameTok = ts.peek();
  if (nameTok.kind !== 'SLOT') {
    ts.report('S0007', nameTok.span);
    return null;
  }
  ts.advance(); // consume name

  if (ts.expect('COLON', 'S0011') === null) return null;

  const type = parseTypeExpr(ts);
  if (type === null) return null;

  return { name: nameTok.value, nameSpan: nameTok.span, type, span: { start: nameTok.span.start, end: type.span.end } };
}
