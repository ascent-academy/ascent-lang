# Lexer refactor — modularising the scanner

An implementation plan for restructuring `src/lexer.ts` along the strata a
hand-written lexer is really made of: a **character alphabet**, a **cursor**
over the source, the **recognition rules**, and a **lexeme classifier**. The
current lexer is correct and clean; every step here is **behaviour-preserving**
— the token stream and the `errorMarkers` it produces must not change. This is a
structural refactor, not a feature.

## Ground rules

- **One stage per commit; every stage leaves the lexer green.** After each stage
  the REPL still produces identical tokens for the same input.
- **No behaviour change.** Same `Token[]`, same `ErrorMarker[]`, same `L0001` /
  `L0002` on the same inputs. If a stage would change a diagnostic, stop — that
  is a different task.
- **No new token kinds, no grammar change.** `token.ts` is untouched.
- **Verification (no automated tests yet):** run `npm start` and confirm the
  transcripts in *Regression checks* below are unchanged. Treat these as the
  acceptance oracle until a real test file exists — adding one is the optional
  final stage.

## Target shape

```
src/
  chars.ts     → the alphabet: pure predicates over a single character
  cursor.ts    → source navigation: pos/line/col, peek/advance/match, mark/span
  keywords.ts  → KEYWORDS + CONSTRUCTORS tables (+ a resolve helper)
  lexer.ts     → recognition rules only: readWord, readNumber, nextToken
```

Each file answers exactly one question: *what characters exist*, *where am I in
the source*, *is this word reserved*, *what token comes next*.

---

## Stage 1 — Extract the character alphabet (`chars.ts`)

**Goal:** move the character-class predicates out of the lexer and add the
compound predicates that are currently inlined.

- **Changes:** create `src/chars.ts` exporting `isDigit`, `isAlpha`,
  `isAlphaNum` (= `isAlpha || isDigit`), `isUpper`, and `isWhitespace` (the four
  cases now spelled out in `skipWhitespace`). Import them into `lexer.ts` and
  delete the local `isDigit`/`isAlpha`.
- **Why first:** it's the lowest-risk move — pure functions, no state — and it
  gives the later stages (`consumeWhile`, `readWord`, `readNumber`) a single
  definition of "identifier character" and "whitespace" to lean on.
- **Watch:** `isAlphaNum` must be *exactly* `isAlpha(ch) || isDigit(ch)` so the
  three trailing-junk loops keep the same acceptance set.
- **Done when:** `lexer.ts` imports from `chars.ts` and the regression checks are
  unchanged.

## Stage 2 — Extract the cursor (`cursor.ts`)

**Goal:** pull all source-navigation state — `pos`, `line`, `col` — and the
lookahead/span helpers into their own object. This is the biggest SRP win: the
lexer stops doing column arithmetic.

- **Changes:** create `class Cursor` owning `src`, `pos`, `line`, `col` and
  exposing `peek(offset?)`, `advance()`, `atEnd()`, `mark()`, `spanFrom(start)`,
  and `slice(start)` (returns `src.slice(start.offset, this.pos)`). The
  newline-resets-column rule lives in `advance()` only. `Lexer` holds a
  `private c: Cursor` and delegates; delete the moved fields/methods.
- **Why:** `readNumber` should reason about float grammar, not about
  incrementing `col`. Position tracking becomes independently testable.
- **Watch:** `mark()`/`spanFrom()` semantics are identical (end is exclusive,
  one past the last char). The `\0` end sentinel stays inside the cursor.
- **Done when:** `Lexer` contains no `this.pos` / `this.line` / `this.col`
  references and the regression checks are unchanged.

## Stage 3 — `match()` and the operator collapse

**Goal:** name the maximal-munch decision once and remove the six repeated
"peek-then-maybe-advance" blocks for two-character operators.

- **Changes:** add `match(ch: string): boolean` to `Cursor` (advance only if the
  next char equals `ch`). Rewrite the `<`, `>`, `=` cases as
  `this.token(this.c.match('=') ? 'LT_EQ' : 'LT', start)` etc.; likewise `!=`.
- **Why:** the `if (peek === '=') { advance; return two } return one` idiom is
  maximal munch spelled out longhand five times. `match` is the standard idiom
  and states the intent.
- **Watch:** `!` still errors as `L0001` when not followed by `=` — that branch
  must survive the rewrite. `==` vs `=` and `!=` ordering unchanged.
- **Depends on:** Stage 2 (cursor exists to hang `match` on).

## Stage 4 — `token()` factory and `consumeWhile()`

**Goal:** remove the token-construction boilerplate and the three identical
"advance while predicate" loops.

- **Changes:**
  - `private token(kind, start): Token` returning
    `{ kind, value: this.c.slice(start), span: this.c.spanFrom(start) }`. Route
    every non-error return through it. This also makes `value` *always* the
    consumed lexeme by construction, retiring the hand-written `value: '+'`
    literals.
  - `private consumeWhile(pred): void` = `while (pred(this.c.peek())) advance()`.
    Use it in `skipWhitespace` (`isWhitespace`), the digit runs (`isDigit`), and
    the identifier run (`isAlphaNum`).
- **Why:** each `read*` method should read like its regular expression; the
  factory removes a correctness footgun (lexeme vs. hand-typed literal drift).
- **Watch:** the punctuation `value`s produced by `token()` must equal the old
  hardcoded strings — they do, because each consumed exactly one char.
- **Depends on:** Stages 1–2.

## Stage 5 — Extract the keyword classifier (`keywords.ts`)

**Goal:** give lexeme classification its own module.

- **Changes:** move `KEYWORDS` and `CONSTRUCTORS` (with their comments) into
  `src/keywords.ts`. Optionally add `resolveWord(value, firstCh): TokenKind |
  undefined` encapsulating the "uppercase → constructor table, else keyword
  table, else SLOT/error" decision, so `readWord` just calls it and handles the
  `undefined → L0001/SLOT` split.
- **Why:** the reserved-word set is a data concern that grows independently of
  the scanning rules; isolating it keeps `lexer.ts` about *scanning*.
- **Watch:** the uppercase-not-a-constructor path must still yield `L0001`, and
  lowercase-not-a-keyword must still yield `SLOT`.

## Stage 6 — Untangle `readNumber` (behaviour-sensitive — decide the approach)

**Goal:** collapse the duplicated trailing-alpha check and make the number rule
read like its grammar. Unlike Stages 1–5 this touches the one method where a
careless edit *changes which diagnostic fires*, so it gets its own stage, its
own edge-case checklist, and a design decision to make first.

**The tangle today.** `readNumber` writes the "a letter may not immediately
follow a number" rule *twice* — once after the fractional digits and once after
the integer digits — and the sibling `.5 → L0002` case lives separately up in
`nextToken`. Three spots, one rule.

**Recommended approach — *maximal munch, then classify*.** Scan the whole
numeric run first, decide int-vs-float by whether a `.`+digit was consumed, then
apply the trailing-letter check **once** at the end:

```ts
private readNumber(): Token {
  const start = this.c.mark();
  this.consumeWhile(isDigit);

  let kind: TokenKind = 'INT_LIT';
  if (this.c.peek() === '.' && isDigit(this.c.peek(1))) {
    this.c.advance();              // '.'
    this.consumeWhile(isDigit);
    kind = 'FLOAT_LIT';
  }

  // A number may not be glued to a letter: 123abc / 1.5x are one malformed
  // token, not a number followed by a name.
  if (isAlpha(this.c.peek())) {
    this.consumeWhile(isAlphaNum);
    return this.error('L0002', this.c.spanFrom(start));
  }

  return this.token(kind, start);
}
```

This is **behaviour-preserving** — I've walked the edges (`42`, `3.14`,
`123abc`, `1.5x`, `3.`, `3.method`, `1.5.3`) and each yields the same token and
same code as today. The dot is still only consumed with a digit on both sides,
so `3.` keeps the `.` for a later token.

**The open sub-decision — what to do with the leading-dot case (`.5`).** Two
choices; this is the part I'd have you pick:

- **A (recommended, smallest): leave `.5` in `nextToken`.** The dispatch already
  routes on the first character; a number starting with `.` is genuinely a
  dispatch concern. `readNumber` stays "starts with a digit". Zero behaviour
  change, three spots become two.
- **B (fully unified): let `readNumber` own leading dots too.** Route `.`+digit
  from `nextToken` into `readNumber` and have it accept an optional leading dot.
  One method owns every number-shaped lexeme — but it re-opens the "is `.5` a
  valid literal" question (today it's deliberately `L0002`), so it risks turning
  a structural refactor into a **grammar change**. Only take this if you also
  want to revisit that rule.

Recommendation: **A**. It gets the real win (the single trailing-alpha check)
without touching the grammar. Keep B on the table only if you later decide
leading-dot floats should lex differently.

- **Depends on:** Stage 1 (`isAlphaNum`), Stage 4 (`consumeWhile`, `token`).
- **Done when:** the trailing-letter rule appears exactly once and the number
  regression checks below are unchanged.

## Stage 7 (optional) — Lock it down with a test file

**Goal:** turn the regression transcripts below into an actual test so future
edits can't silently change the token stream.

- **Changes:** add a small `src/lexer.test.ts` (or a `scripts/` harness matching
  the repo's tsx style) asserting `tokenize()` output for the regression inputs,
  and wire up `npm test`. Scope this to the lexer only.

---

## Regression checks (the acceptance oracle)

Run each through `npm start` before and after every stage; output must be
identical. Chosen to cover every branch the refactor touches.

- `42` → `INT_LIT`, `EOF`
- `3.14` → `FLOAT_LIT`
- `123abc` → `L0002`; `1.5x` → `L0002`; `3.` → `INT_LIT` `3` then `.` as a later
  token; `3.method` → `INT_LIT` `3` then `.`…; `1.5.3` → `FLOAT_LIT` `1.5` then `.3`; `.5` → `L0002`
- `fix mut if else while div mod` → the seven keyword kinds
- `True False None Done` → `BOOL_LIT`/`NONE_LIT`/`DONE_LIT`; `Foo` → `L0001`
- `x _y a1` → `SLOT`
- `== != <= >= < > =` → the two-char operators vs their one-char fallbacks
- `!` alone → `L0001`; `@` → `L0001`
- `+ - * / ; ( ) { }` → the punctuation kinds
- whitespace/newlines across all of the above → spans (line/column) unchanged

## Explicitly out of scope

- **Pull-based `Iterator<Token>` / lazy streaming.** Only worth it if the parser
  wants to drive lexing; today's batch `tokenize()` array loses nothing.
- **Table-driven DFA / lexer-generator (regex → NFA → DFA).** The hand-written
  scanner gives better diagnostics (the `L0001`/`L0002` split) and is the right
  call at this language size.
- **The dual ERROR-token + marker channel.** Sound design — keep it.
- **Keyword-as-table-lookup.** Already the recommended approach — keep it.
