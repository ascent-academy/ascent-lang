# Building Ascent — outline & section briefs

A build-log for the Ascent interpreter: the language and its implementation grown **one small capability at a time**, each step fully understood before the next. Audience: the implementer (and any future contributor). Companion to `ascent-whitepaper.md`, which is the source of truth for every decision and is referenced by section number (§N) throughout.

This file is an **outline**: each section below is a brief, not the finished prose. It is written to be handed — one section at a time — to an agent that also has the full whitepaper, which then writes the section.

---

## How to fill a section (instructions for the writing agent)

Every section has the **same two-part shape**, and must keep them separate:

1. **How it works (technical).** Normative and concrete, but *explained*, never a bare spec dump. Walk the capability through the pipeline in this fixed order, including only what this section adds:
   - **Tokens** — the new token kinds, and why *only* these now.
   - **Grammar fragment** — the *small* set of new/changed rules in EBNF (3–5 rules max), each followed by a plain-prose reading of what it allows and what it deliberately doesn't yet. Never restate the whole grammar — only the delta. By the final section the reader has assembled the grammar rule by rule.
   - **AST** — the node(s) this adds and the data they carry.
   - **Evaluation** — how the tree-walker turns those nodes into values; the representation choices; the one or two genuinely interesting bits.
   - **Errors it can now produce** — the exact diagnostic codes (from `errors.ts`) that become reachable here, each with the input that triggers it.
   - **Run it** — a REPL transcript: several inputs → outputs, *including at least one input that fails and the diagnostic it yields*. A section that ends with nothing runnable is wrong — fix the scope.
2. **Why it's built this way (reasoning).** The design decisions behind the above, drawn from the whitepaper (cite §§). This is where the false-friend analysis, the principle being upheld, and the rejected alternatives go. Keep it out of part 1 so the technical reading stays clean.

Discipline (do not break): **one new capability per section; every section ends with something that runs; every "is an error" clause names its code.** Assume only the capabilities of earlier sections — no forward references. Where code already exists (`lexer.ts`, `diagnostic.ts`, `errors.ts` are written), point at the relevant slice and explain it in growth order rather than pretending it isn't there; the parser and evaluator are being written as the log proceeds.

Tone: explanatory and exact. Not marketing (that's the landing page), not a terse reference (that's a different document), not a beginner tutorial (that assumes no implementation interest). The reader wants to *understand the machine*.

Suggested filenames: `00-orientation.md`, `01-a-number.md`, … numbered to match below.

---

## Section 0 — Orientation

**Goal:** the reader understands the shape of the journey and the four-stage pipeline before any feature exists.

- **Content:** the pipeline `source → [lexer] → tokens → [parser] → AST → [evaluator] → value → [REPL] prints it`; what each stage owns; that the type checker is deliberately deferred (we run dynamically first, §12); the JS prototype choices (`Int` = `BigInt`, `Float` = `number`, §12); how diagnostics flow as `RawDiagnostic` facts elaborated later (§9, and the existing `diagnostic.ts`/`errors.ts`/`messages.ts`). State the per-section two-part contract so the reader knows the rhythm.
- **No code to run yet** — this is the only section exempt from "ends running"; it ends with "here's the skeleton we'll grow."
- **Whitepaper source:** §12 (build path + stages), §9 (diagnostics).

## Section 1 — A number and a REPL

**Goal:** type `42`, get `42`. The entire pipeline exists end-to-end on the simplest possible value.

- **Technical:** token `INT_LIT` (and `EOF`); the smallest grammar (`program := expr`; `expr := INT_LIT`); a `Literal` AST node holding a `BigInt`; an evaluator that returns it; the REPL loop that reads a line, runs the pipeline, prints the value. Representation: `Int` is `BigInt` and *why that's already correct* for exactness. Errors reachable: `L0001` (a character that starts no token), `L0002` (malformed number — `123abc`, leading/trailing dot), `S0002` (expected an expression on empty input). 
- **Reasoning:** why build the *whole pipeline* on one value first (architecture once, features after — the cure for the 40%-parser problem); why integers before everything; why a tree-walking interpreter before bytecode (§12); why `BigInt` (exactness, §4 "traps, no silent wraparound" foreshadowed); the `42` literal rule and why digits-both-sides for floats is foreshadowed but not yet needed.
- **Run it:** `42 → 42`; `7 → 7`; `12abc → [L0002]`; `@ → [L0001]`.
- **Whitepaper source:** §2 (literals, identifiers, tokens), §4 (`Int`), §12.
- **Depends on:** §0.

## Section 2 — Arithmetic

**Goal:** `1 + 2 * 3` → `7`, with correct precedence and grouping.

- **Technical:** tokens `PLUS MINUS STAR LPAREN RPAREN`. Introduce **Pratt parsing** on this tiny grammar — explain binding powers concretely on `+ - *`, left-associativity, and grouping with parens. AST: a `Binary{op, left, right}` node and a `Unary{op, operand}` node (unary `-`). Evaluation over `BigInt`; **`Int` overflow traps** → `R0002`. The precedence ladder so far: `+ -` < `* /`-tier < unary `-` < atoms. Errors reachable: `S0004` (unclosed `(`), `S0001`/`S0002` (e.g. `1 +`), `R0002` (overflow).
- **Reasoning:** why Pratt over a hand-rolled precedence cascade or a generated parser (§12 — readability, error quality, ports to Rust); why these precedences (match mainstream so it transfers); why trap overflow instead of wrapping (§4, honesty); why words-vs-symbols isn't relevant yet (that's logic, §5).
- **Run it:** `1 + 2 * 3 → 7`; `(1 + 2) * 3 → 9`; `-(2 * 3) → -6`; `(1 + → [S00xx]`.
- **Whitepaper source:** §5 (operators, precedence table), §4 (`Int` overflow), §12 (Pratt).
- **Depends on:** §1.

## Section 3 — The second number type: Float

**Goal:** `2 + 1.5` → `3.5` (a `Float`), while `2 + 3` stays `5` (an `Int`).

- **Technical:** token `FLOAT_LIT` (digits both sides — `3.14`, never `3.` or `.5`, which are `L0002`). `Float` = JS `number`. The **one-way promotion rule**: in `+ - *`, all-`Int` → `Int`, any `Float` present → `Float` (the `Int` operand is converted to `number`). How the evaluator decides result type and performs the promotion. `NaN`/`Infinity` are runtime errors, not values (note where that check lives; reachability may be minimal until division). Errors: `L0002` (malformed float).
- **Reasoning:** *two number types, not one* — why a single float-number (the JS model) is rejected (0.1+0.2, 2^53 integer rounding, contradiction with §4's no-NaN/overflow-trap promises); the one-way promotion and why it's the *only* coercion Ascent allows (§1 honesty reframed, §5); why `Int`→`Float` is safe (value-preserving) but `Float`→`Int` is not (needs explicit `toInt`); the digits-both-sides literal rule and how it frees `.` for member access later (§4). Note that `T0001 int-float-mix` is **retired** — mixing is now legal — and why (registry retirement, §9).
- **Run it:** `2 + 1.5 → 3.5`; `2 + 3 → 5`; `2.0 + 3 → 5.0`; `3. → [L0002]`.
- **Whitepaper source:** §4 (`Float`, literal form), §5 (promotion), §1 (honesty), §12 (BigInt/number).
- **Depends on:** §2.

## Section 4 — Division

**Goal:** `7 / 2` → `3.5`; `7 div 2` → `3`.

- **Technical:** token `KW_DIV` (the word `div`, a reserved keyword); `/` already lexes as `SLASH`. Rules: **`/` always yields `Float`** (both operands promoted if needed); **`div` is `Int`-only floor division** (toward −∞), and `div` on a `Float` is `T0003`. Division by zero (`/` or `div`) is `R0001`. Where these checks sit in the evaluator. Extend the precedence ladder: `div` joins the `*`/`/` tier. Errors: `R0001` (divide by zero), `T0003` (`div` on Float).
- **Reasoning:** why `/` always floats (kills the silent integer-truncation/average bug *without* day-one ceremony — §5); why a separate `div` rather than overloading `/` (honest: integer vs real division are different operations); why the keyword `div` and not `//` (the `//` collision — comment in C-family, floor-div in Python — §2); floor-toward-−∞ choice; divide-by-zero as a loud crash not a `NaN`/`Infinity` (§4, §9). Note `T0002 division-needs-float` is **retired** and why.
- **Run it:** `7 / 2 → 3.5`; `6 / 2 → 3.0`; `7 div 2 → 3`; `7 div 0 → [R0001]`; `2.5 div 2 → [T0003]`.
- **Whitepaper source:** §5 (division), §9 (crash model), §2 (`//` vacated).
- **Depends on:** §3.

## Section 5 — Booleans and logic

**Goal:** `true and not false` → `true`.

- **Technical:** tokens `BOOL_LIT` (`true`/`false`), `KW_AND KW_OR KW_NOT`. `Bool` = JS boolean. **Operators are words, Bool-only**: `and`/`or` (binary), `not` (unary, prefix). No truthiness — a non-`Bool` operand is `T0004`. Short-circuit evaluation for `and`/`or` (state it explicitly). Extend the precedence ladder: `or` < `and` < `not`, all looser than the arithmetic tiers established so far. Errors: `T0004` (non-Bool operand).
- **Reasoning:** why words not `&& || !` (they'd be a *false friend* — JS `||` coerces and returns an operand; words honestly signal "stricter, Bool-only" — §5); **no truthiness** and why that's load-bearing for honesty (§1); short-circuit semantics; why `not` is a keyword not `!` (the lexer already rejects bare `!` as `L0001`, foreshadowing — §, the existing lexer).
- **Run it:** `true and false → false`; `not (1 == 1) → false` *(forward-peek: comparisons land next; use `not true` if avoiding `==` here)* → prefer `not true → false`; `1 and true → [T0004]`.
- **Whitepaper source:** §5 (logic operators, no truthiness), §1.
- **Depends on:** §2 (precedence machinery). Note: keep examples to Bool literals so this section doesn't depend on comparisons.

## Section 6 — Comparisons

**Goal:** `1 + 1 == 2` → `true`; `1 < 2.5` → `true`.

- **Technical:** tokens `EQ_EQ BANG_EQ LT LT_EQ GT GT_EQ`. `==`/`!=` are **structural and same-type**, *except* `Int`/`Float` compare as numbers (`1 == 1.0` is `true`, via the one-way promotion); `< <= > >=` on `Int`/`Float`/`String`, with `Int`/`Float` mixing allowed. Comparisons are **non-associative** (no `a < b < c` chaining) — say how the parser enforces that. Results are `Bool`. Cross-type comparison of unrelated types (e.g. `Int` vs `Bool`) is `T0005`. Place comparisons in the precedence ladder (between `or`/`and`/`not` and `+ -`). Errors: `T0005` (operand-type-mismatch).
- **Reasoning:** why coercion-free `==` (it's everyone-but-JS; teaches "yours is TS's `===`" — §5); why extend numeric promotion to comparison (consistency with arithmetic — the same one rule, §5); why non-associative comparisons (chaining is a footgun / ambiguous); structural equality and why function comparison is forbidden (foreshadow §4).
- **Run it:** `2 == 2 → true`; `1 == 1.0 → true`; `1 < 2.5 → true`; `2 != 3 → true`; `1 == true → [T0005]`.
- **Whitepaper source:** §5 (`==`, comparisons, promotion).
- **Depends on:** §3 (promotion), §5 (Bool result type).

## Section 7 — Strings

**Goal:** `"hello"` → `hello` (literal strings as values; no interpolation yet).

- **Technical:** token `STRING_LIT`; the lexer's string reader — double quotes only, escapes `\" \\ \n \t \r` (invalid escape → `L0004`), unterminated → `L0005`. `String` = JS string, immutable, Unicode. **No integer indexing, no `Char` type** (chars are length-1 strings); `length` counts code points (note even if `length` isn't wired yet). Single quotes are not string syntax. Errors: `L0004` (invalid escape), `L0005` (unterminated string).
- **Reasoning:** double-quote-only and why single quotes are unused (one way; the apostrophe-in-content argument — §4 and the strings discussion); no `Char` and why (avoids the Unicode-index bug class — §4); immutability; why `${`/`$` are still just literal characters *here* (interpolation is the next section, and the lexer reads them as plain text until then).
- **Run it:** `"hello" → hello`; `"line\nbreak" → ` (two lines); `"oops\q" → [L0004]`; `"unterminated → [L0005]`.
- **Whitepaper source:** §4 (`String`), §2 (comments/strings lexing), and the existing `lexer.ts` `readString`.
- **Depends on:** §1 (pipeline).

## Section 8 — String interpolation

**Goal:** `"sum is ${1 + 2}"` → `sum is 3`.

- **Technical:** the **stateful lexer**: `${` flips from string-mode to expression-mode, the inner expression is lexed/parsed with the machinery from §§1–6, brace-balancing finds the matching `}`, then string-mode resumes. A literal `${` is escaped `\$`; a lone `$` and bare `{ }` are literal. AST: a `Interpolation` node (a sequence of string chunks and expression holes) or equivalent; evaluation concatenates chunk values, coercing each expression's value to its string form. Note how values render (Int, Float, Bool, String) to text. Errors: existing codes from the embedded expression (e.g. `S0002` inside `${}`), plus an unterminated-interpolation case if you choose to add one (allocate the next free `L` code if so — append to the registry, never reuse).
- **Reasoning:** always-on but `${`-triggered, and why that frees literal braces (§4); `${}` over bare `{}` (visual + the JS template-literal transfer, with the backtick false-friend taught as a graduation note — §4 and the interpolation discussion); why interpolation is a lexer concern (the stateful-lexing rationale, §12); why a hand-written lexer is what makes this clean (§12).
- **Run it:** `"sum is ${1 + 2}" → sum is 3`; `"${2 * 3} done" → 6 done`; `"price $5" → price $5`; `"literal \${x}" → literal ${x}`.
- **Whitepaper source:** §4 (interpolation model), §12 (stateful lexing).
- **Depends on:** §§1–7.

## Section 9 — Statements and the value of a program

**Goal:** a program of several `;`-separated statements runs, and its value is the last one: `1 + 1; 2 * 3` → `6`.

- **Technical:** the grammar shifts from "one expression" to `program := stmt*`, with `;` terminating statements; an expression-statement. **Every block yields the value of its last statement**, and the trailing `;` is optional (like a list's trailing comma). A statement that isn't a value yields `Done` (introduce the `Done`/`{}` unit value here, minimally). Errors: `S0003` (expected `;`).
- **Reasoning:** the last-statement-value rule and why it's *one* rule for everything (the resolved duality — §2, §15-retired); why optional trailing `;` (not load-bearing, the trailing-comma analogy — §2); why this is cleaner than Rust's semicolon-significance; how it sets up "a program is the body of an implicit `main`" (§11, foreshadow `args`); `Done` as the value of non-value statements.
- **Run it:** `1 + 1; 2 * 3 → 6`; `41; 42; → 42` (trailing `;` fine); `1 + 1 2 * 3 → [S0003]`.
- **Whitepaper source:** §2 (block-value rule), §4 (`Done`), §11 (implicit `main`).
- **Depends on:** §§1–6 (expressions to sequence).

## Section 10 — Slots: naming and remembering values

**Goal:** `fix x = 1 + 2; x * x` → `9`; `mut n = 0; n = n + 1; n` → `1`.

- **Technical:** tokens `KW_FIX KW_MUT`, identifiers as references, `EQ` for declaration and assignment. Grammar: `decl := ("fix" | "mut") IDENT "=" expr ";"`; `assign := IDENT "=" expr ";"`; `IDENT` as an expression (a reference). The environment: a single global scope (a name→value map) for now. The **name → slot → value** model; **value semantics** (assignment copies). Rules and their codes: reference to an undeclared name → `N0001`; redeclaring in scope → `N0002`; assigning to a `fix` slot → `N0003`; assigning to a never-declared name → `N0004`; `fix`/`mut` not followed by a name → `S0005`.
- **Reasoning:** `fix`/`mut` with **no default** and why (every declaration legible alone; the aliasing argument doesn't apply under value semantics — §3); why not `let`/`const`/`val` (cross-language false friends — §3); the slot-as-container-not-reference model and how it *is* the value-semantics lesson (§3); why `fix` is reassignment-not-deep-immutability; why a single global scope is enough for now (lexical scope is a later section, §12 stage 2).
- **Run it:** `fix x = 1 + 2; x * x → 9`; `mut n = 0; n = n + 1; n → 1`; `fix y = 1; y = 2; → [N0003]`; `z + 1 → [N0001]`; `fix = 5 → [S0005]`.
- **Whitepaper source:** §3 (slots), §1 (value semantics), §12 (stage 1 scope rules).
- **Depends on:** §9 (statements), §§1–6 (expressions).

---

## After Stage 1 (later sections, for orientation only — not yet briefed)

Lexical scope & blocks → `if`/`else if` as expressions → `while` → `match` + `type` (records, then unions, exhaustiveness) → construction & field access → methods → functions & calls (`return` as early-exit) → `none`/`?`/`??` → collections (`List`, `map`/`filter`) → `args` & the environment → the static type checker (the codes that fired at runtime now fire earlier, same numbers) → modules → async → UI/MVU. Each follows the same two-part shape and the one-capability-per-section discipline.
