import type { Token } from '../lexer/token.js';
import type { Expr, Statement, Block, If, Match, MatchArm, Pattern, LiteralPattern, TypeExpr, FieldDecl, VariantDecl, BindTarget, FieldPattern, ImportClause, ImportName } from './ast.js';
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
  const parsed = ts.parseSeparated(() => parseStmt(ts), 'SEMICOLON', 'RBRACE', 'S0002', true, openTok.span);
  if (parsed === null) return null;

  // Imports are file-level only (whitepaper §10) — they bring names in for the
  // whole file and can't be scoped inside any body: a function, a loop, an 'if',
  // a block expression, or the 'program' body (all of which come through here).
  for (const stmt of parsed.items) {
    if (stmt.kind === 'import') ts.report('S0042', stmt.span);
  }

  return { kind: 'block', stmts: parsed.items, span: { start: openTok.span.start, end: parsed.close.span.end } };
}

// The parenthesized test shared by 'if' and 'while' — '(' expr ')'.
// The body braces already delimit the construct, but the test stays
// parenthesized to match the C-family/TS surface (§5).
function parseCond(ts: TokenStream): Expr | null {
  const open = ts.expect('LPAREN', 'S0010');
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
  const openTok = ts.expect('LBRACE', 'S0009');
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

// 'match subject { pat -> body; … }' — an expression (whitepaper §5), so it
// clusters here with the other braced control constructs but is reached from
// parseAtom, like 'if'. Unlike 'if'/'while', the subject is a *bare* expression
// with no parentheses (parens are only for a condition) — the arms' braces
// already delimit it, exactly as a 'for' loop's iterable needs none. Parsing
// stops at the '{' since it's neither an infix nor a postfix operator. The arms
// sit between braces, each separated by ';' like a block's statements (trailing
// ';' optional).
export function parseMatch(ts: TokenStream): Match | null {
  const matchTok = ts.advance(); // consume 'match'

  const subject = parseExpr(ts);
  if (subject === null) {
    return null;
  }

  const open = ts.expect('LBRACE', 'S0034');
  if (open === null) return null;

  // Arms are separated by commas (like a record's fields or a list's items) —
  // not semicolons — with a trailing comma allowed (design.md §5). A ';' inside
  // an arm still terminates statements within a '{ … }' block body as usual.
  const parsed = ts.parseSeparated(() => parseMatchArm(ts), 'COMMA', 'RBRACE', 'S0002', false, open.span);
  if (parsed === null) return null;

  return {
    kind: 'match',
    subject,
    arms: parsed.items,
    span: { start: matchTok.span.start, end: parsed.close.span.end },
  };
}

// One 'pattern -> body' arm. The body is either a '{ … }' block — the arm's
// body position is one of the few spots a block may appear, so a '{' right after
// '->' opens one directly here (parseAtom refuses a '{', S0044) — or any other
// expression, parsed with the ordinary parseExpr, which stops at the ',' or '}'
// that ends the arm (neither an operator).
function parseMatchArm(ts: TokenStream): MatchArm | null {
  const pattern = parsePattern(ts);
  if (pattern === null) {
    return null;
  }

  if (ts.expect('ARROW', 'S0036') === null) return null;

  const body = ts.peek().kind === 'LBRACE' ? parseBlock(ts) : parseExpr(ts);
  if (body === null) {
    return null;
  }

  return { pattern, body, span: { start: pattern.span.start, end: body.span.end } };
}

// A pattern is the 'else' catch-all, a variant pattern (an UpperCamel tag, bare
// or with a '{ … }' field list), 'None' / a lowercase name for the two cases of
// an Optional, or a scalar literal (whitepaper §5).
function parsePattern(ts: TokenStream): Pattern | null {
  const tok = ts.peek();
  if (tok.kind === 'KW_ELSE') {
    ts.advance(); // consume 'else'
    return { kind: 'elsePattern', span: tok.span };
  }
  // 'None' matches an Optional's absent case (it lexes as NONE_LIT, its own token
  // — not a TYPE_NAME — so it's handled here rather than as a variant pattern).
  if (tok.kind === 'NONE_LIT') {
    ts.advance(); // consume 'None'
    return { kind: 'nonePattern', span: tok.span };
  }
  // A lowercase name binds an Optional's present value (whitepaper §7's narrowing
  // by binding). The name is arbitrary; the checker rejects it on a non-Optional.
  if (tok.kind === 'SLOT') {
    ts.advance(); // consume the binding name
    return { kind: 'bindingPattern', name: tok.value, nameSpan: tok.span, span: tok.span };
  }
  if (tok.kind === 'TYPE_NAME') {
    ts.advance(); // consume the variant tag
    return parseVariantPattern(ts, tok);
  }
  return parseLiteralPattern(ts);
}

// 'Tag' or 'Tag{ field, field: local, … }' in match position — a variant
// pattern. The tag is already consumed; a '{' introduces its bound fields, and
// its absence makes a bare tag that binds nothing (an enum case, or a fielded
// variant matched for its tag alone). Reuses parseFieldPattern, the same field
// syntax as a destructuring binding. Empty braces bind nothing, so they're the
// banned redundant spelling (S0023) — write the bare tag instead.
function parseVariantPattern(ts: TokenStream, tagTok: Token): Pattern | null {
  if (ts.peek().kind !== 'LBRACE') {
    return { kind: 'variantPattern', tag: tagTok.value, tagSpan: tagTok.span, fields: [], span: tagTok.span };
  }
  const open = ts.advance(); // consume '{'
  const parsed = ts.parseSeparated(() => parseFieldPattern(ts), 'COMMA', 'RBRACE', 'S0002', false, open.span);
  if (parsed === null) return null;
  const span = { start: tagTok.span.start, end: parsed.close.span.end };
  if (parsed.items.length === 0) {
    ts.report('S0023', span);
  }
  return { kind: 'variantPattern', tag: tagTok.value, tagSpan: tagTok.span, fields: parsed.items, span };
}

// A literal pattern is a constant to compare the subject against: an Int, Float,
// Bool, or plain String literal. A leading '-' forms a negative number. An
// interpolated string ('${…}', which lexes as a leading STR_PART) isn't a
// constant, so it can't be a pattern — it falls through to the S0035 report.
function parseLiteralPattern(ts: TokenStream): LiteralPattern | null {
  const tok = ts.peek();

  if (tok.kind === 'MINUS') {
    ts.advance(); // consume '-'
    const num = ts.peek();
    if (num.kind === 'INT_LIT') {
      ts.advance();
      return { kind: 'litPattern', valueType: 'Int', value: -BigInt(num.value), span: { start: tok.span.start, end: num.span.end } };
    }
    if (num.kind === 'FLOAT_LIT') {
      ts.advance();
      return { kind: 'litPattern', valueType: 'Float', value: -parseFloat(num.value), span: { start: tok.span.start, end: num.span.end } };
    }
    // A '-' with no number after it isn't a pattern.
    ts.report('S0035', num.span);
    return null;
  }

  if (tok.kind === 'INT_LIT') {
    ts.advance();
    return { kind: 'litPattern', valueType: 'Int', value: BigInt(tok.value), span: tok.span };
  }
  if (tok.kind === 'FLOAT_LIT') {
    ts.advance();
    return { kind: 'litPattern', valueType: 'Float', value: parseFloat(tok.value), span: tok.span };
  }
  if (tok.kind === 'BOOL_LIT') {
    ts.advance();
    return { kind: 'litPattern', valueType: 'Bool', value: tok.value === 'True', span: tok.span };
  }
  // A plain string (no holes) is a single STR_PART_END carrying its decoded
  // text; its value is the constant to match against.
  if (tok.kind === 'STR_PART_END') {
    ts.advance();
    return { kind: 'litPattern', valueType: 'String', value: tok.value, span: tok.span };
  }

  ts.report('S0035', tok.span);
  return null;
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

// 'for name in iterable { }' — a statement (§5), like 'while'. It takes
// *no* parens (it has no test): parenthesizing it would mimic TypeScript's
// key-iterating 'for…in', the false friend the 'in'-for-values choice
// avoids. The body braces are mandatory (§2), same as every other loop.
function parseFor(ts: TokenStream): Statement | null {
  const forTok = ts.advance(); // consume 'for'

  // The loop variable is a BindTarget — a plain name or a destructuring pattern
  // (whitepaper §5), the same as a fix/mut binding — so 'for Point{ x, y } in ps'
  // pulls each element's fields apart per iteration.
  const target = parseBindTarget(ts, 'S0015');
  if (target === null) return null;

  if (ts.expect('KW_IN', 'S0016') === null) return null;

  const iterable = parseExpr(ts);
  if (iterable === null) {
    return null;
  }

  const body = parseRequiredBlock(ts);
  if (body === null) {
    return null;
  }

  return {
    kind: 'for',
    target,
    iterable,
    body,
    span: { start: forTok.span.start, end: body.span.end },
  };
}

// One field entry inside a record destructuring pattern: 'name' (punned — the
// field binds a local of the same name) or 'name: local' (renamed). The field
// name and the local are both lowercase slot names (design.md §2's casing);
// unlike a construction's 'field: value', the right of ':' is a *binding name*,
// not an expression, so there are no nested patterns here (v1 patterns are
// shallow).
function parseFieldPattern(ts: TokenStream): FieldPattern | null {
  const nameTok = ts.peek();
  if (nameTok.kind !== 'SLOT') {
    ts.report('S0020', nameTok.span);
    return null;
  }
  ts.advance(); // consume field name

  let bindTok = nameTok; // punned by default: the local is named for the field
  if (ts.peek().kind === 'COLON') {
    ts.advance(); // consume ':'
    const renamed = ts.peek();
    if (renamed.kind !== 'SLOT') {
      ts.report('S0007', renamed.span);
      return null;
    }
    ts.advance(); // consume the renamed local
    bindTok = renamed;
  }

  return {
    field: nameTok.value, fieldSpan: nameTok.span,
    bind: bindTok.value, bindSpan: bindTok.span,
    span: { start: nameTok.span.start, end: bindTok.span.end },
  };
}

// 'TypeName{ field, field: local, … }' in binding position — a record
// destructuring pattern (whitepaper §5). The tag is already consumed by
// parseBindTarget and a '{' confirmed on lookahead. Whether the tag really
// names an *irrefutable* single-variant record (and not a refutable union case)
// is a checker question (T0034); the parser only records the shape. Empty braces
// bind nothing, so they're the same one-spelling ban as everywhere else (S0023).
function parseRecordPattern(ts: TokenStream, typeNameTok: Token): BindTarget | null {
  const open = ts.expect('LBRACE', 'S0019');
  if (open === null) return null;
  const parsed = ts.parseSeparated(() => parseFieldPattern(ts), 'COMMA', 'RBRACE', 'S0002', false, open.span);
  if (parsed === null) return null;
  const span = { start: typeNameTok.span.start, end: parsed.close.span.end };
  if (parsed.items.length === 0) {
    ts.report('S0023', span);
  }
  return { kind: 'record', typeName: typeNameTok.value, typeNameSpan: typeNameTok.span, fields: parsed.items, span };
}

// A binding target: a plain lowercase name, or an UpperCamel record pattern that
// destructures the bound value (whitepaper §5). Shared by a 'fix'/'mut'
// declaration and a 'for' loop's variable — a TYPE_NAME here always introduces a
// pattern (there is no other meaning for one in binding position), so a missing
// '{' after it is an S0019, not a fall-through. `missingCode` is the error for a
// token that's neither a name nor a pattern — S0007 after fix/mut, S0015 in a
// 'for'.
function parseBindTarget(ts: TokenStream, missingCode: string): BindTarget | null {
  const tok = ts.peek();
  if (tok.kind === 'SLOT') {
    ts.advance(); // consume slot name
    return { kind: 'name', name: tok.value, nameSpan: tok.span, span: tok.span };
  }
  if (tok.kind === 'TYPE_NAME') {
    ts.advance(); // consume the pattern's type tag
    return parseRecordPattern(ts, tok);
  }
  ts.report(missingCode, tok.span);
  return null;
}

// 'fix' and 'mut' share every rule but the keyword itself and the
// mutability it grants — one parse method, told which by 'kind'.
function parseDecl(ts: TokenStream, kind: 'fix' | 'mut'): Statement | null {
  const kwTok = ts.advance(); // consume 'fix' or 'mut'

  const target = parseBindTarget(ts, 'S0007');
  if (target === null) return null;

  // Only a plain-name binding takes a ':' annotation — a record pattern already
  // names its type, so an annotation there would be redundant.
  let typeAnnotation: TypeExpr | null = null;
  if (target.kind === 'name' && ts.peek().kind === 'COLON') {
    ts.advance(); // consume ':'
    typeAnnotation = parseTypeExpr(ts);
    if (typeAnnotation === null) return null;
  }

  if (ts.expect('EQUALS', 'S0008') === null) return null;

  const init = parseExpr(ts);
  if (init === null) {
    return null;
  }

  return {
    kind,
    target,
    typeAnnotation,
    init,
    span: { start: kwTok.span.start, end: init.span.end },
  };
}

// One 'name: Type' field inside a record's declaration braces. The field
// name is a lowercase binding (design.md §2's casing rule); its type is a
// full TypeExpr, so a field may itself be 'List<T>', 'T?', or another record.
function parseFieldDecl(ts: TokenStream): FieldDecl | null {
  const nameTok = ts.peek();
  if (nameTok.kind !== 'SLOT') {
    ts.report('S0020', nameTok.span);
    return null;
  }
  ts.advance(); // consume field name

  if (ts.expect('COLON', 'S0021') === null) return null;

  const type = parseTypeExpr(ts);
  if (type === null) return null;

  return { name: nameTok.value, nameSpan: nameTok.span, type, span: { start: nameTok.span.start, end: type.span.end } };
}

// The '{ field: Type, … }' body shared by both the record-sugar head and every
// fielded union variant: the fields between '{' and '}'. The opening '{' is
// already confirmed on lookahead by the caller. Empty braces are rejected
// (S0023) — a variant with no fields is written without braces at all (its
// braceless enum form) — but the fields (empty) are still returned so parsing
// carries on. Returns the fields and the '}' token, or null if malformed.
function parseFields(ts: TokenStream): { fields: FieldDecl[]; close: Token } | null {
  const open = ts.expect('LBRACE', 'S0019');
  if (open === null) return null;
  const parsed = ts.parseSeparated(() => parseFieldDecl(ts), 'COMMA', 'RBRACE', 'S0002', false, open.span);
  if (parsed === null) return null;
  if (parsed.items.length === 0) {
    ts.report('S0023', { start: open.span.start, end: parsed.close.span.end });
  }
  return { fields: parsed.items, close: parsed.close };
}

// One variant of a union: a bare 'Tag' (a zero-field enum case) or 'Tag{ field:
// Type, … }' (a case that carries fields) — whitepaper §6. The tag is an
// UpperCamel constructor name; a '{' after it introduces its fields, and its
// absence makes it a braceless enum case.
function parseVariantDecl(ts: TokenStream): VariantDecl | null {
  const tagTok = ts.peek();
  if (tagTok.kind !== 'TYPE_NAME') {
    ts.report('S0022', tagTok.span);
    return null;
  }
  ts.advance(); // consume variant tag

  if (ts.peek().kind !== 'LBRACE') {
    // Braceless: a zero-field enum case, ending at the tag itself.
    return { tag: tagTok.value, tagSpan: tagTok.span, fields: [], span: tagTok.span };
  }

  const body = parseFields(ts);
  if (body === null) return null;

  return { tag: tagTok.value, tagSpan: tagTok.span, fields: body.fields, span: { start: tagTok.span.start, end: body.close.span.end } };
}

// 'type Name = …;' — a type declaration (whitepaper §6). Two heads share one
// representation: the record sugar 'type Name = { … }' becomes a single variant
// whose tag is `name`, and the union form 'type Name = A{ … } | B{ … }' (a lone
// leading '|' allowed) becomes that list of variants. The explicit single
// variant 'type Name = Name{ … }' is just the one-variant union.
function parseTypeDecl(ts: TokenStream): Statement | null {
  const typeTok = ts.advance(); // consume 'type'

  const nameTok = ts.peek();
  if (nameTok.kind !== 'TYPE_NAME') {
    ts.report('S0017', nameTok.span);
    return null;
  }
  ts.advance(); // consume type name

  if (ts.expect('EQUALS', 'S0018') === null) return null;

  const variants: VariantDecl[] = [];
  if (ts.peek().kind === 'LBRACE') {
    // Record sugar: the sole constructor's tag is the type's own name.
    const body = parseFields(ts);
    if (body === null) return null;
    variants.push({ tag: nameTok.value, tagSpan: nameTok.span, fields: body.fields, span: { start: nameTok.span.start, end: body.close.span.end } });
  } else {
    // Union form: an optional leading '|', then '|'-separated variants.
    if (ts.peek().kind === 'PIPE') ts.advance();
    for (; ;) {
      const variant = parseVariantDecl(ts);
      if (variant === null) return null;
      variants.push(variant);
      if (ts.peek().kind !== 'PIPE') break;
      ts.advance(); // consume the '|' before the next variant
    }
  }

  return {
    kind: 'typeDecl',
    name: nameTok.value,
    nameSpan: nameTok.span,
    variants,
    span: { start: typeTok.span.start, end: variants[variants.length - 1]!.span.end },
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

// 'void expr' — evaluates `expr` for effect and discards its value (§2). A
// statement, not a prefix operator: it takes a *full* expression, so
// 'void x + 1' discards 'x + 1' rather than parsing as '(void x) + 1'.
function parseVoid(ts: TokenStream): Statement | null {
  const voidTok = ts.advance(); // consume 'void'

  const expr = parseExpr(ts);
  if (expr === null) {
    return null;
  }

  return { kind: 'void', expr, span: { start: voidTok.span.start, end: expr.span.end } };
}

export function parseStmt(ts: TokenStream): Statement | null {
  if (ts.peek().kind === 'KW_IMPORT') {
    return parseImport(ts);
  }
  if (ts.peek().kind === 'KW_VOID') {
    return parseVoid(ts);
  }
  if (ts.peek().kind === 'KW_FIX') {
    return parseDecl(ts, 'fix');
  }
  if (ts.peek().kind === 'KW_MUT') {
    return parseDecl(ts, 'mut');
  }
  if (ts.peek().kind === 'KW_WHILE') {
    return parseWhile(ts);
  }
  if (ts.peek().kind === 'KW_FOR') {
    return parseFor(ts);
  }
  if (ts.peek().kind === 'KW_TYPE') {
    return parseTypeDecl(ts);
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

// One name in a braced import list — a lowercase export name ('min').
function parseImportName(ts: TokenStream): ImportName | null {
  const tok = ts.peek();
  if (tok.kind !== 'SLOT') {
    ts.report('S0007', tok.span);
    return null;
  }
  ts.advance();
  return { name: tok.value, span: tok.span };
}

// 'import { a, b } from "mod";' (named) or 'import mod from "mod";' (namespace)
// — a stdlib import (whitepaper §10). The braces pick the form: '{ … }' brings
// specific exports into scope to be used bare, a bare name binds the whole
// module for qualified use. The specifier is a *plain* double-quoted string — a
// module name is a compile-time constant, so a '${…}' hole in it is meaningless
// (its first token would be STR_PART, not STR_PART_END) and rejected.
function parseImport(ts: TokenStream): Statement | null {
  const importTok = ts.advance(); // consume 'import'

  let clause: ImportClause;
  if (ts.peek().kind === 'LBRACE') {
    const open = ts.advance(); // consume '{'
    const parsed = ts.parseSeparated(() => parseImportName(ts), 'COMMA', 'RBRACE', 'S0002', false, open.span);
    if (parsed === null) return null;
    clause = { kind: 'named', names: parsed.items };
  } else if (ts.peek().kind === 'SLOT') {
    const nameTok = ts.advance();
    clause = { kind: 'namespace', binding: nameTok.value, bindingSpan: nameTok.span };
  } else {
    ts.report('S0039', ts.peek().span);
    return null;
  }

  if (ts.expect('KW_FROM', 'S0040') === null) return null;

  const spec = ts.peek();
  if (spec.kind !== 'STR_PART_END') {
    ts.report('S0041', spec.span);
    return null;
  }
  ts.advance(); // consume the module specifier

  return {
    kind: 'import',
    clause,
    module: spec.value,
    moduleSpan: spec.span,
    span: { start: importTok.span.start, end: spec.span.end },
  };
}
