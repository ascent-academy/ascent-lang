import type { Token, TokenKind } from '../lexer/token.js';
import type { Expr, BinaryOp, UnaryOp, TemplatePart, FieldInit } from './ast.js';
import type { TokenStream } from './token-stream.js';
import { parseBlock, parseIf, parseMatch } from './stmt.js';
import { dedent, type RawChunk } from './dedent.js';

// ---- Pratt parsing ----------------------------------------------------
//
// A Pratt parser recognises an expression as an atom (a "nud" — null
// denotation, a value that doesn't look left at anything) optionally
// followed by a chain of infix or postfix operators (each a "led" —
// left denotation, because it combines the value already parsed with
// whatever comes after it).
//
// Every operator — prefix, infix, or postfix — has a binding power: a
// number saying how tightly it grabs its operands. Higher binds
// tighter — that's what encodes precedence: '*' outbinds '+', so
// `1 + 2 * 3` parses as `1 + (2 * 3)`, not `(1 + 2) * 3`. The parsing
// loop only accepts an operator when its binding power is at least
// `minBp` — the "how tight does the *caller* need things bound"
// threshold passed down on each recursive call.
//
// This ladder is the single source of truth for what binds tighter
// than what: postfix (`.method()`, `[index]`) and '**' bind tightest
// (tighter even than unary '-', per §5 of design.md — `-2 ** 2` is
// `-(2 ** 2)`), then unary '-', then '*'/'/'/'div'/'mod', then '+'/'-',
// then '..' (the range operator), then the comparisons, then 'not',
// then 'and', then 'or', loosest — the word operators sit below the
// comparisons (§5 of design.md), so `a == b and c == d` groups as
// `(a == b) and (c == d)`, never `a == (b and c) == d`. Every table
// below is keyed off these numbers instead of inlining its own.
//
// RANGE ('..') sits just below additive so a range's bounds may be
// arithmetic without parentheses — `a+1..b-1` groups as `(a+1)..(b-1)`
// — while staying tighter than the comparisons (a Range is never itself
// compared, so their relative order is only a fallback). It has no row
// in INFIX_OPS: '..' builds a distinct `range` node, not a `binary` one,
// so it's matched by hand in the loop below (like the postfix operators).
//
// EXPONENT shares POSTFIX's tier rather than sitting strictly above it.
// '**' is right-associative, so its right operand is parsed with
// `minBp = infix.bp` (not `+ 1`, see the loop below) — if EXPONENT
// outbid POSTFIX, that recursive parse would stop *before* absorbing a
// trailing postfix chain (`2 ** a.b()` would parse `a` alone, leaving
// `.b()` to wrongly attach to the whole `2 ** a` once control returned
// to the caller). Equal tiers let the right-hand parse swallow both a
// further '**' and any postfix chain in one pass.
const BP = {
  OR: 1,
  AND: 2,
  NOT: 3,
  COMPARISON: 4,
  RANGE: 5,
  ADDITIVE: 6,
  MULTIPLICATIVE: 7,
  UNARY: 8,
  POSTFIX: 8,
  EXPONENT: 8,
} as const;

// Every binary operator this parser knows about has one row in this
// table. Adding the next one means adding a row, never touching the
// loop below. '*', '/', 'div' and 'mod' all share a binding power —
// they're the same precedence tier — so all four outbind '+', which
// in turn outbinds the comparisons — `1 + 2 < 3 * 4` groups as
// `(1 + 2) < (3 * 4)`. Comparisons are also marked `assoc: 'none'`:
// unlike '+' or '*', two of them can never sit side by side
// (`a < b < c` is rejected, not silently grouped one way or the other).
// 'or' belongs to a tier below 'and' — the same "same precedence,
// left-associative" shape as '+'/'-' — so `a or b or c` groups as
// `(a or b) or c`.
const INFIX_OPS: Partial<Record<TokenKind, { op: BinaryOp; bp: number; assoc: 'left' | 'right' | 'none' }>> = {
  KW_OR: { op: 'or', bp: BP.OR, assoc: 'left' },
  KW_AND: { op: 'and', bp: BP.AND, assoc: 'left' },
  EQ_EQ: { op: '==', bp: BP.COMPARISON, assoc: 'none' },
  BANG_EQ: { op: '!=', bp: BP.COMPARISON, assoc: 'none' },
  LT: { op: '<', bp: BP.COMPARISON, assoc: 'none' },
  LT_EQ: { op: '<=', bp: BP.COMPARISON, assoc: 'none' },
  GT: { op: '>', bp: BP.COMPARISON, assoc: 'none' },
  GT_EQ: { op: '>=', bp: BP.COMPARISON, assoc: 'none' },
  PLUS: { op: '+', bp: BP.ADDITIVE, assoc: 'left' },
  MINUS: { op: '-', bp: BP.ADDITIVE, assoc: 'left' },
  STAR: { op: '*', bp: BP.MULTIPLICATIVE, assoc: 'left' },
  SLASH: { op: '/', bp: BP.MULTIPLICATIVE, assoc: 'left' },
  KW_DIV: { op: 'div', bp: BP.MULTIPLICATIVE, assoc: 'left' },
  KW_MOD: { op: 'mod', bp: BP.MULTIPLICATIVE, assoc: 'left' },
  // Right-associative — `2 ** 3 ** 2` groups as `2 ** (3 ** 2)` (§5).
  STAR_STAR: { op: '**', bp: BP.EXPONENT, assoc: 'right' },
};

// Postfix table — dot-calls and indexing are "led" operators exactly
// like the binary ones above (they look left at the value already
// parsed), so they're declared here and dispatched on in the loop
// below instead of being special-cased ahead of the INFIX_OPS lookup.
// Both bind at POSTFIX — tighter than unary or any binary operator —
// which is why `-a.b()[0]` parses as `-(a.b()[0])`.
const POSTFIX_OPS: Partial<Record<TokenKind, { bp: number }>> = {
  DOT: { bp: BP.POSTFIX },
  LBRACKET: { bp: BP.POSTFIX },
};

// Prefix table — the Pratt parser's other operator kind (a "nud" that
// still takes an operand, parsed in parseAtom below). Unary '-' binds
// tight, at the same tier as postfix; 'not' binds much looser — tighter
// than 'and'/'or' but looser than the comparisons — which is what makes
// `not a == b` parse as `not (a == b)` rather than `(not a) == b`.
const PREFIX_OPS: Partial<Record<TokenKind, { op: UnaryOp; bp: number }>> = {
  MINUS: { op: '-', bp: BP.UNARY },
  KW_NOT: { op: 'not', bp: BP.NOT },
};

export function parseExpr(ts: TokenStream, minBp = 0): Expr | null {
  let left = parseAtom(ts);
  if (left === null) {
    return null;
  }

  // Tracks whether a non-associative (comparison-tier) operator has
  // already been consumed at this call's level — a second one directly
  // beside it (`a < b < c`) is a chain, not a grouping choice, so it's
  // rejected here rather than silently parsed left- or right-first.
  let chained = false;

  while (true) {
    const kind = ts.peek().kind;

    // Postfix: expr.method(args) or expr[index] — dispatched by table
    // rather than special-cased ahead of the INFIX_OPS lookup below.
    const postfix = POSTFIX_OPS[kind];
    if (postfix !== undefined) {
      if (postfix.bp < minBp) break;
      left = kind === 'DOT' ? parseDotAccess(ts, left) : parseIndex(ts, left);
      if (left === null) return null;
      continue;
    }

    // Range 'lo..hi' — built as its own `range` node (not a binary one),
    // so it's handled here rather than through INFIX_OPS. The right bound
    // is parsed at RANGE + 1 so a second '..' can't nest into it; a Range
    // isn't an Int, so `a..b..c` is meaningless — it parses as `(a..b)..c`
    // and the checker rejects the Range bound (T0016) rather than the
    // parser guessing a grouping.
    if (kind === 'DOTDOT') {
      if (BP.RANGE < minBp) break;
      ts.advance(); // consume '..'
      const hi = parseExpr(ts, BP.RANGE + 1);
      if (hi === null) return null;
      left = { kind: 'range', lo: left, hi, span: { start: left.span.start, end: hi.span.end } };
      continue;
    }

    const infix = INFIX_OPS[kind];
    if (infix === undefined || infix.bp < minBp) {
      break;
    }

    if (infix.assoc === 'none') {
      if (chained) {
        ts.report('S0008', ts.peek().span);
        return null;
      }
      chained = true;
    }

    ts.advance(); // consume the operator

    // Left-associativity — `1 + 2 + 3` must parse as `(1 + 2) + 3`,
    // not `1 + (2 + 3)`. Parsing the right-hand side with `bp + 1`
    // (instead of `bp`) is what enforces that: it stops a second '+'
    // from being absorbed into the *right* operand, forcing it to
    // instead be picked up by the loop one level up. Non-associative
    // operators reuse the same `bp + 1` call — it still keeps looser
    // operators out of the right operand, and the `chained` check
    // above is what stops them from reappearing at this level.
    // Right-associative operators ('**') do the opposite: reusing the
    // same `bp` (not `+ 1`) lets a second '**' at this level be
    // absorbed into the right operand instead of returned to this loop,
    // which is what makes `2 ** 3 ** 2` group as `2 ** (3 ** 2)`.
    const right = parseExpr(ts, infix.assoc === 'right' ? infix.bp : infix.bp + 1);
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

// 'receiver.member' — DOT already confirmed on lookahead by the Pratt loop.
// The member name is the same either way; a following '(' makes it a method
// call, anything else a field read (design.md §6 — 'p.name' vs 'p.trim()').
function parseDotAccess(ts: TokenStream, receiver: Expr): Expr | null {
  ts.advance(); // consume '.'

  const memberTok = ts.peek();
  if (memberTok.kind !== 'SLOT') {
    ts.report('S0012', memberTok.span);
    return null;
  }
  ts.advance(); // consume member name

  if (ts.peek().kind !== 'LPAREN') {
    // No '(' — this is a field read, not a call. (A field never chains into a
    // call without another '.', so there's nothing more to consume here.)
    return {
      kind: 'fieldAccess',
      receiver,
      field: memberTok.value,
      fieldSpan: memberTok.span,
      span: { start: receiver.span.start, end: memberTok.span.end },
    };
  }
  const openParen = ts.advance(); // consume '('

  const parsed = ts.parseSeparated(() => parseExpr(ts), 'COMMA', 'RPAREN', 'S0001', false, openParen.span);
  if (parsed === null) return null;

  return {
    kind: 'methodCall',
    receiver,
    method: memberTok.value,
    args: parsed.items,
    span: { start: receiver.span.start, end: parsed.close.span.end },
  };
}

// 'list[index]' — LBRACKET already confirmed on lookahead by the Pratt loop.
function parseIndex(ts: TokenStream, list: Expr): Expr | null {
  const openBracket = ts.advance(); // consume '['

  const index = parseExpr(ts);
  if (index === null) return null;

  const rbracket = ts.expect('RBRACKET', 'S0013', [{ key: 'opener', span: openBracket.span }]);
  if (rbracket === null) return null;

  return {
    kind: 'index',
    list,
    index,
    span: { start: list.span.start, end: rbracket.span.end },
  };
}

// parseAtom parses the smallest possible expression: a single literal
// that doesn't depend on any operator. This is the Pratt parser's nud —
// every future one (parenthesized groups, unary '-', identifiers) is
// just another case added here, never a change to the loop above.
function parseAtom(ts: TokenStream): Expr | null {
  const tok = ts.peek();

  if (tok.kind === 'INT_LIT') {
    ts.advance();
    return {
      kind: 'literal',
      valueType: 'Int',
      value: BigInt(tok.value),
      span: tok.span
    };
  }

  if (tok.kind === 'FLOAT_LIT') {
    ts.advance();
    return {
      kind: 'literal',
      valueType: 'Float',
      value: parseFloat(tok.value),
      span: tok.span
    };
  }

  if (tok.kind === 'STR_PART' || tok.kind === 'STR_PART_END') {
    return parseStringTemplate(ts);
  }

  if (tok.kind === 'MSTR_PART' || tok.kind === 'MSTR_PART_END') {
    return parseMultilineStringTemplate(ts);
  }

  if (tok.kind === 'BOOL_LIT') {
    ts.advance();
    return {
      kind: 'literal',
      valueType: 'Bool',
      value: tok.value === 'True',
      span: tok.span
    };
  }

  if (tok.kind === 'NONE_LIT') {
    ts.advance();
    return { kind: 'literal', valueType: 'None', span: tok.span };
  }

  if (tok.kind === 'DONE_LIT') {
    ts.advance();
    return { kind: 'literal', valueType: 'Done', span: tok.span };
  }

  if (tok.kind === 'SLOT') {
    ts.advance();
    if (ts.peek().kind === 'LPAREN') {
      return parseCall(ts, tok);
    }
    return { kind: 'slot', name: tok.value, span: tok.span };
  }

  if (tok.kind === 'TYPE_NAME') {
    ts.advance();
    if (ts.peek().kind === 'LBRACE') {
      return parseConstruct(ts, tok);
    }
    // A bare UpperCamel name in value position builds a zero-field variant — an
    // enum case like 'Red' (whitepaper §6). Whether the name really is a
    // zero-field constructor (and not, say, a record that needs fields) is a
    // checker question; the parser just records a braceless construction.
    return { kind: 'construct', typeName: tok.value, typeNameSpan: tok.span, fields: [], braces: false, span: tok.span };
  }

  if (tok.kind === 'LPAREN') {
    ts.advance();
    const inner = parseExpr(ts);
    if (inner === null) {
      return null;
    }
    const closing = ts.peek();
    if (closing.kind !== 'RPAREN') {
      ts.report('S0001', closing.span, [{ key: 'opener', span: tok.span }]);
      return null;
    }
    ts.advance(); // consume ')'
    return inner;
  }

  const prefix = PREFIX_OPS[tok.kind];
  if (prefix !== undefined) {
    const start = tok.span.start;
    ts.advance();
    const operand = parseExpr(ts, prefix.bp);
    if (operand === null) {
      return null;
    }
    return { kind: 'unary', op: prefix.op, operand, span: { start, end: operand.span.end } };
  }

  if (tok.kind === 'LBRACKET') {
    return parseList(ts);
  }

  if (tok.kind === 'LBRACE') {
    return parseBlock(ts);
  }

  if (tok.kind === 'KW_IF') {
    return parseIf(ts);
  }

  if (tok.kind === 'KW_MATCH') {
    return parseMatch(ts);
  }

  ts.report('S0002', tok.span);
  return null;
}

// A String's chunks and holes: 'STR_PART' text, then an expression, then the
// next chunk, alternating until 'STR_PART_END' closes the string. The lexer
// guarantees the token right after a hole's expression is always another
// chunk token (it silently swallows the hole-closing '}' and resumes
// chunk-scanning, mirroring how the closing '"' is swallowed) — so parsing a
// hole is just an ordinary parseExpr call, no bespoke closing-token handling.
// A String with no holes at all (a single STR_PART_END) collapses to the
// plain literal node, unchanged from before this feature existed.
function parseStringTemplate(ts: TokenStream): Expr | null {
  const first = ts.advance(); // consume the opening chunk
  if (first.kind === 'STR_PART_END') {
    return { kind: 'literal', valueType: 'String', value: first.value, span: first.span };
  }

  const start = first.span.start;
  const parts: TemplatePart[] = [{ kind: 'text', value: first.value }];
  let end = first.span.end;

  while (true) {
    const hole = parseExpr(ts);
    if (hole === null) return null;
    parts.push({ kind: 'hole', expr: hole });

    const chunk = ts.peek();
    if (chunk.kind !== 'STR_PART' && chunk.kind !== 'STR_PART_END') {
      // The hole's expression stopped before the lexer's forced closing
      // point (e.g. '${ 1 2 }' — two atoms, no operator between them) —
      // there's leftover content the hole can't hold.
      ts.report('S0015', chunk.span);
      return null;
    }
    ts.advance();
    parts.push({ kind: 'text', value: chunk.value });
    end = chunk.span.end;
    if (chunk.kind === 'STR_PART_END') break;
  }

  return { kind: 'template', parts, span: { start, end } };
}

// A multiline """..."""  string's chunks and holes — the same alternating
// shape as parseStringTemplate above, and holes are parsed exactly the same
// way, but the chunk tokens (MSTR_PART/MSTR_PART_END) carry *raw* text —
// escapes undecoded, margin unstripped. Margin dedent is a whole-literal
// computation (the closing '"""''s column isn't known until the end), so it
// can't run chunk by chunk during the scan the way single-line escapes do —
// instead every raw chunk is collected first, then dedent() (src/parser/
// dedent.ts) turns the whole set into final text in one pass once the
// terminal chunk (carrying `margin`) is in hand.
function parseMultilineStringTemplate(ts: TokenStream): Expr | null {
  const first = ts.advance(); // consume the opening chunk
  const start = first.span.start;
  const rawChunks: RawChunk[] = [{ raw: first.value, span: first.span }];
  const holes: Expr[] = [];
  let end = first.span.end;
  let last = first;

  while (last.kind !== 'MSTR_PART_END') {
    const hole = parseExpr(ts);
    if (hole === null) return null;
    holes.push(hole);

    const chunk = ts.peek();
    if (chunk.kind !== 'MSTR_PART' && chunk.kind !== 'MSTR_PART_END') {
      // Same S0015 as a single-line hole: leftover content the hole can't hold.
      ts.report('S0015', chunk.span);
      return null;
    }
    ts.advance();
    rawChunks.push({ raw: chunk.value, span: chunk.span });
    end = chunk.span.end;
    last = chunk;
  }

  const { texts, errors } = dedent(rawChunks, last.dedentMargin ?? 0);
  for (const e of errors) ts.report(e.code, e.span);
  if (errors.length > 0) return null;

  if (holes.length === 0) {
    return { kind: 'literal', valueType: 'String', value: texts[0]!, span: { start, end } };
  }

  const parts: TemplatePart[] = [];
  for (let i = 0; i < texts.length; i++) {
    parts.push({ kind: 'text', value: texts[i]! });
    if (i < holes.length) parts.push({ kind: 'hole', expr: holes[i]! });
  }
  return { kind: 'template', parts, span: { start, end } };
}

// 'name(arg, arg, …)' — callee token already consumed by parseAtom.
function parseCall(ts: TokenStream, callee: Token): Expr | null {
  const openParen = ts.advance(); // consume '('
  const parsed = ts.parseSeparated(() => parseExpr(ts), 'COMMA', 'RPAREN', 'S0001', false, openParen.span);
  if (parsed === null) return null;

  return {
    kind: 'call',
    callee: callee.value,
    args: parsed.items,
    span: { start: callee.span.start, end: parsed.close.span.end },
  };
}

// One 'field: value' entry inside a record construction. The field name is a
// lowercase binding; ':' separates it from the value expression (design.md §6
// — ':' builds, '=' would be the 'with'-update form, which isn't here yet).
function parseFieldInit(ts: TokenStream): FieldInit | null {
  const nameTok = ts.peek();
  if (nameTok.kind !== 'SLOT') {
    ts.report('S0021', nameTok.span);
    return null;
  }
  ts.advance(); // consume field name

  if (ts.expect('COLON', 'S0022') === null) return null;

  const value = parseExpr(ts);
  if (value === null) return null;

  return { name: nameTok.value, nameSpan: nameTok.span, value, span: { start: nameTok.span.start, end: value.span.end } };
}

// 'TypeName{ field: value, … }' — record construction. The name token is
// already consumed by parseAtom, and an LBRACE confirmed on lookahead.
function parseConstruct(ts: TokenStream, typeNameTok: Token): Expr | null {
  const open = ts.advance(); // consume '{'
  const parsed = ts.parseSeparated(() => parseFieldInit(ts), 'COMMA', 'RBRACE', 'S0005', false, open.span);
  if (parsed === null) return null;

  return {
    kind: 'construct',
    typeName: typeNameTok.value,
    typeNameSpan: typeNameTok.span,
    fields: parsed.items,
    braces: true,
    span: { start: typeNameTok.span.start, end: parsed.close.span.end },
  };
}

// '[' expr, expr, … ']' — list literal. Already peeked '[' in parseAtom.
function parseList(ts: TokenStream): Expr | null {
  const openTok = ts.advance(); // consume '['
  const parsed = ts.parseSeparated(() => parseExpr(ts), 'COMMA', 'RBRACKET', 'S0013', false, openTok.span);
  if (parsed === null) return null;

  return { kind: 'list', elements: parsed.items, span: { start: openTok.span.start, end: parsed.close.span.end } };
}
