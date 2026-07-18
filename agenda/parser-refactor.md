# Parser refactor — plan

The parser ([src/parser/expr.ts](../src/parser/expr.ts), [stmt.ts](../src/parser/stmt.ts),
[type-expr.ts](../src/parser/type-expr.ts) over a shared
[token-stream.ts](../src/parser/token-stream.ts)) is already a modern, well-built
recursive-descent + **Pratt** parser. It is not a mess to be rescued. It has the
things that separate a principled parser from an ad-hoc one:

- **Precedence-climbing (Pratt)** expression parsing with one BP ladder as the
  single source of truth (`BP` in [expr.ts](../src/parser/expr.ts)).
- **Free-function productions over a shared `TokenStream`** rather than a monolithic
  `Parser` class — the genuinely modern structural choice.
- **Panic-mode recovery** with a real `synchronize()` and a `recover` path in
  `parseSeparated`.
- **Two-phase diagnostics** (raw `Marker`s → `elaborate()`), so the grammar never
  bakes in prose.
- A **discriminated-union AST** with a `span` on every node.

So this plan is not "fix a broken design." It's "close the gap between what the
parser *claims* about itself and what the code actually does," in the same shape as
[typechecker-refactor.md](./typechecker-refactor.md): pure-win extractions first, one
principled representation change in the middle, the behavioural change gated behind
its own decision, cleanup last.

## The core problem

There are three seams where the current design violates a principle it already
states, in decreasing order of value:

1. **The Pratt loop doesn't keep its own "add a row, don't touch the loop" promise.**
   The `INFIX_OPS` comment says "Adding the next one means adding a row, never
   touching the loop below" — but the loop has **four hand-written branches** outside
   the tables (`DOTDOT`/range, `QUESTION_QUESTION`/coalesce, `KW_WITH`, and the
   `DOT`/`LBRACKET`/`LPAREN` postfix ternary). Each exists only because it builds a
   node that isn't a `binary`. That is exactly the thing a principled Pratt design
   factors *out*, not *around*.

2. **`parseAtom` is the `nud` half written as a 160-line `if`-chain**, while the loop
   is the `led` half written as table + branches. The two halves of one Pratt parser
   are expressed in two different styles.

3. **Manual `T | null` threading is a hand-rolled error monad.** Every production
   returns `T | null` and nearly every call site is
   `const x = parseФ(); if (x === null) return null;` — dozens of times. It works and
   it's explicit, but it's the most repetitive thing in the parser, it's the identical
   tangle the checker plan calls out, and it means the parser is **neither total nor
   lossless** while the lexer it consumes is *both* (bad chars → `ERROR` tokens,
   lexing continues; trivia preserved). The parser throws that fidelity away.

## The principled lens: a Pratt parser is two dispatch tables + a driver

The canonical modern formulation (Kladov, "Simple but Powerful Pratt Parsing";
Crockford's original) is:

- a **`nud` table** (null denotation) keyed by token kind — how to start an
  expression from a token that looks left at nothing (a literal, `(`, a prefix
  operator, `if`/`match`/`fn`);
- a **`led` table** (left denotation) keyed by token kind — how to extend an
  expression the parser already has to its left, each entry carrying its left binding
  power and a handler;
- a **driver loop** that does nothing but: look up the `led` for the next token,
  stop if its binding power is below `minBp`, otherwise dispatch.

Mapping today's code onto that shows precisely what's out of place: `INFIX_OPS` is a
partial `led` table (precedence only, no handler, so the *action* leaks into the
loop), `POSTFIX_OPS` is another partial `led` table (same problem), the range /
coalesce / with branches are `led` handlers with nowhere to live, and `parseAtom` is
the entire `nud` table collapsed into one function.

---

## Phase 1 — Span & node-construction helpers (pure win)

`span: { start: a.span.start, end: b.span.end }` is computed inline ~30 times across
[expr.ts](../src/parser/expr.ts) and [stmt.ts](../src/parser/stmt.ts). Extract:

```ts
// src/parser/span.ts
export const spanning = (a: { span: Span }, b: { span: Span }): Span =>
  ({ start: a.span.start, end: b.span.end });
export const spanFromTo = (start: Span, end: Span): Span =>
  ({ start: start.start, end: end.end });
```

Every node literal then reads as pure structure (`span: spanning(left, right)`), and
a whole class of transposed-`.start`/`.end` bugs becomes unwriteable. Zero behaviour
change, no AST change, mechanical. Do this first — it's independent of everything
below and shrinks the diff of every later phase.

Optionally add thin node constructors (`binaryNode`, `rangeNode`, …) if Phase 2's
handlers want them, but the span helper is the whole win here.

## Phase 2 — A `led` handler table: unify the Pratt loop (the principled change)

Turn `INFIX_OPS` + `POSTFIX_OPS` + the four inline branches into **one** table whose
entries carry a handler, not just a number:

```ts
type Led = {
  lbp: number;
  parse: (ts: TokenStream, left: Expr, tok: Token) => Expr | null;
};

const LED: Partial<Record<TokenKind, Led>> = {
  PLUS:      { lbp: BP.ADDITIVE,       parse: binaryLed('+',  'left')  },
  STAR_STAR: { lbp: BP.EXPONENT,       parse: binaryLed('**', 'right') },
  EQ_EQ:     { lbp: BP.COMPARISON,     parse: binaryLed('==', 'none')  },
  // …the rest of INFIX_OPS, unchanged in meaning…
  DOTDOT:            { lbp: BP.RANGE,    parse: rangeLed    },  // builds a `range`
  QUESTION_QUESTION: { lbp: BP.COALESCE, parse: coalesceLed },  // builds a `coalesce`
  KW_WITH:           { lbp: BP.WITH,     parse: withLed     },  // builds a `with`
  DOT:      { lbp: BP.POSTFIX, parse: dotLed    },
  LBRACKET: { lbp: BP.POSTFIX, parse: indexLed  },
  LPAREN:   { lbp: BP.POSTFIX, parse: applyLed  },
};
```

The driver collapses to the canonical form:

```ts
export function parseExpr(ts: TokenStream, minBp = 0): Expr | null {
  let left = parseAtom(ts);
  if (left === null) return null;

  while (true) {
    const led = LED[ts.peek().kind];
    if (led === undefined || led.lbp < minBp) break;
    const tok = ts.advance();
    const next = led.parse(ts, left, tok);
    if (next === null) return null;
    left = next;
  }
  return left;
}
```

Key consequences, all improvements:

- **Range, coalesce, and `with` stop being special.** They're `led` handlers that
  happen to build a different node kind and pick their own right-recursion `minBp`.
  Adding a future operator with a bespoke node (say `|>`) is genuinely "add a row."
- **Associativity moves into `binaryLed`,** where the `bp` vs `bp + 1` right-recursion
  choice lives next to the operator it governs, instead of in the loop.
- **The non-associative `chained`/S0005 check moves into the comparison handler.**
  Right now `chained` is loop state that only the `assoc: 'none'` operators use; it
  belongs to them. (Implementation note: a comparison `led` can enforce "no second
  comparison as my right operand" by parsing its right side at `lbp + 1` and refusing
  a comparison `led` at the same level — the same effect the `chained` flag has today,
  but local.)
- **Postfix stops being a ternary.** `DOT`/`LBRACKET`/`LPAREN` are three rows, not a
  `kind === 'DOT' ? … : …` chain.

This is self-contained: **no AST change, no downstream change.** `npm test` covers the
precedence/associativity grammar thoroughly, so behaviour preservation is checkable to
the token. This is the flagship phase — the one that makes the parser's own comments
true.

## Phase 3 — A `nud` handler table for atoms (companion to Phase 2)

Rewrite `parseAtom`'s `if`-chain as the matching `nud` table:

```ts
type Nud = (ts: TokenStream, tok: Token) => Expr | null;

const NUD: Partial<Record<TokenKind, Nud>> = {
  INT_LIT:   intLiteral,
  FLOAT_LIT: floatLiteral,
  STR_PART:  stringTemplate,  STR_PART_END: stringTemplate,
  LPAREN:    parenGroup,
  MINUS:     prefixOp,        KW_NOT: prefixOp,
  LBRACKET:  parseList,
  KW_IF:     () => parseIf(ts),
  KW_MATCH:  () => parseMatch(ts),
  KW_FN:     (ts) => parseFn(ts, false),
  // …etc…
};
```

Atoms that need one token of lookahead keep it *inside* their handler — `SLOT` →
slot / `call` / `asyncCall`, `TYPE_NAME` → `construct` / bare variant — exactly as
today, just localized. `parseAtom` becomes: look up `NUD`, dispatch, or report S0004.

After Phases 2–3 the entire expression grammar is **two tables and a driver**; the
grammar files describe grammar and nothing else, which is the whole point of the
free-function-over-`TokenStream` design taken to its conclusion. This can fold into
Phase 2 or ship right after it.

## Phase 4 — Error propagation: toward a total parser (gated behavioural change)

This is the `T | null` tangle, and it's the one change with a real decision behind it,
so it's gated. Two directions:

**Option A — Error nodes (make the parser total).** Add `{ kind: 'error'; span }` to
the `Expr` / `Statement` unions. A failed production returns an error node instead of
`null`; the driver and call sites stop threading `null`. This is what rust-analyzer /
Roslyn do, and — the deciding argument here — it makes the parser **consistent with
the lexer, which is already total**. The checker already has an `Invalid` tombstone
that absorbs subtyping in both directions; an `error` expr maps straight onto it, so
cascade-suppression is already solved downstream. Cost: every AST consumer
(checker, both printers, interpreter) must have an `error` case, though each is
trivial (treat as `Invalid` / no-op).

**Option B — Throw-and-catch at sync points.** A `parseError` throws; `parseBlock` /
`parseSeparated`'s recover path catch and `synchronize()`. Removes the `null`
boilerplate wholesale without touching the AST. Cost: control-flow-by-exception, and
you lose the ability to keep a partially-built node at the failure site.

Recommendation leans **Option A** — it's the larger change but it aligns parser and
lexer under one "total, error-recovering" philosophy and reuses `Invalid`, whereas
Option B only hides the plumbing. Either way this is a decision to make deliberately,
after Phases 1–3 have landed and shrunk the surface it touches.

---

## Non-goals (deliberately deferred)

- **A lossless CST / red-green tree** (rust-analyzer / Swift-libsyntax: the AST as a
  typed *view* over a full-fidelity concrete tree that preserves whitespace and
  comments). This is *the* modern architecture, and the lexer's already-paid-for
  losslessness is its prerequisite sitting unused. But `printer.ts` is an AST **debug
  dump**, not a source-reconstructing formatter — nothing reconstructs source today —
  so a CST is a large investment for no current payoff. Revisit only when a formatter
  or LSP is on the table.
- **The `expr.ts` ↔ `stmt.ts` mutual import.** Inherent (`if`/`match` are expressions
  with statement bodies) and already deliberate. Leave it.
- **`parseSeparated`'s parameter creep** (`recover`, `openSpan`, `stopAt`). One
  well-tested workhorse; at most fold the flags into an options object, cosmetic.

---

## Recommendation summary (the suggestions, ranked)

1. **Unify the Pratt loop into a `led` handler table (Phase 2).** Highest value: it
   redeems the "add a row, not a branch" promise the code already makes, folds four
   special-case branches (range, coalesce, `with`, postfix) into one uniform
   mechanism, and moves associativity + the non-associative check next to the
   operators they belong to. Self-contained, no AST/downstream change, fully covered
   by the existing precedence tests. **Do this first among the substantive changes.**
2. **Make `parseAtom` a `nud` table (Phase 3).** Companion to #1; after it, the
   expression grammar is two tables and a driver. Low risk, can ship with #1.
3. **Span/node helpers (Phase 1).** Trivial, zero-risk DRY win; do it first because it
   shrinks every later diff. Ordered last in the ranking only because it's the
   smallest, not because it should wait.
4. **Retire `T | null` threading for a total parser (Phase 4).** Real improvement but
   a gated decision (error nodes vs throw-at-sync). Error nodes preferred — aligns the
   parser with the already-total lexer and reuses the checker's `Invalid`. Do it after
   1–3.

Explicitly out of scope: CST/red-green tree, decoupling the expr/stmt cycle, and
reworking `parseSeparated` — see Non-goals.
