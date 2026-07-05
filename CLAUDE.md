# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ascent is an experimental teaching programming language (`@ascent-lang/dev`). This repo is a TypeScript CLI + tree-walking interpreter for `.asc` programs, plus a REPL. The language, parser, interpreter, and APIs are all pre-1.0 and change frequently — don't treat any surface as stable.

`docs/design.md` is the language spec and the primary source of truth for *why* something works the way it does — most non-obvious implementation choices trace back to a section there (referenced in code as `design.md §N`). `docs/principles.md` states the six design principles every language decision answers to. `docs/traits.md` and `agenda/*.md` are parking/planning documents for not-yet-built features (traits/generics, past refactors) — read them for context but don't treat them as current behavior.

## Commands

```bash
npm test                                    # run the full test suite (mocha)
npx mocha --grep "some test name"           # run tests matching a name/describe block
npm run dev                                 # run the CLI/REPL directly from src/ via tsx, no build step
npm run build                               # tsc compile to dist/
npx tsc --noEmit                            # typecheck without emitting
npm run generate                            # regenerate src/errors/index.ts from src/errors/*.yml
```

Note: `.mocharc.json` sets `"spec": "test/**/*.test.ts"`, and this project's mocha always loads that full glob regardless of file arguments on the command line — `npx mocha test/interpolation.test.ts` still runs every test file, not just that one. Use `--grep` to scope to specific tests instead.

`npm run generate` (aliased into `prebuild`/`prestart`) must be re-run after editing any `src/errors/*.yml` file — `src/errors/index.ts` is generated output (checked into git, marked `AUTO-GENERATED — do not edit`) and running tests or `tsx` directly does **not** regenerate it for you.

There is no lint script; `tsc --noEmit` plus the test suite is the whole verification loop.

## Architecture

### Pipeline

Source runs through four independent stages, each with its own module and its own AST shape — `src/parser/index.ts`'s `parse()` chains them:

```
source → Lexer (src/lexer) → tokens → Parser (src/parser) → Program (untyped AST)
       → Typechecker (src/parser/typechecker.ts) → TypedProgram → Interpreter (src/interpreter.ts) → RuntimeValue
```

- **Lexer** (`src/lexer/index.ts`, `cursor.ts`, `chars.ts`, `keywords.ts`, `token.ts`) — hand-written, produces `Token[]` plus lexical `Marker`s. String interpolation and multiline-string dedentation are lexer-level concerns (tokens like `STR_PART`/`STR_PART_END`, margin tracking in `dedent.ts`), not parser ones.
- **Parser** (`src/parser/expr.ts`, `stmt.ts`, `type-expr.ts`) — hand-written recursive descent with Pratt (precedence-climbing) expression parsing. Every production is a free function taking a `TokenStream` (`src/parser/token-stream.ts`), not a method on a monolithic `Parser` class — `TokenStream` owns the cursor, the accumulated `Marker[]`, and the shared combinators (`expect`, `parseSeparated`). Parsing uses panic-mode recovery: a malformed statement can be skipped so the parse continues and surfaces more errors in one pass, so a non-null `Program` does **not** by itself mean error-free — always check the error/diagnostic list too.
- **Typechecker** (`src/parser/typechecker.ts`) — walks the untyped `Program`/`Expr` and produces a parallel `TypedProgram`/`TypedExpr` tree (`src/parser/typed-ast.ts`) with every node's `AscentType` attached. Built-in method/function signatures live in one data table (`METHODS`, `FUNCTIONS`) rather than hand-rolled per-type dispatchers — adding a builtin method means adding a table entry, not new control flow. `TypeEnv` is a chain of scopes mirroring the interpreter's `Environment`, and supports being reused across REPL lines (`ownEntries()`).
- **Interpreter** (`src/interpreter.ts`) — a tree-walking evaluator over `TypedProgram`. `Environment` is a parent-chained scope; `evaluateExpr`/`executeStmt`/`evaluateBlock` are the core recursion. Method dispatch is one `evalMethodCall` switching on receiver type into per-type `eval*Method` functions (`evalIntMethod`, `evalFloatMethod`, `evalStringMethod`, `evalListMethod`), mirroring the typechecker's per-type `METHODS` table.

### Types

`AscentType` (`src/types/types.ts`) is the single source of truth for the type lattice: `Int`, `Float`, `Bool`, `String`, `None`, `Done`, `List<T>`, `Optional<T>` (surface sugar `T?`). Subtyping is `Int <: Float` (value-preserving widening), covariant `List`, and `Optional` widening (a bare `T` or `None` is usable where `T?` is expected — never wrapped, since there's no runtime `Some(...)`); `subtype()` returns the runtime coercion witness (or `false`), and `leastCommonType()`/`isAssignableTo()` are built on top of it. `Optional` is type-system-only so far — no `??`, `try`, or `match` yet, and a bare `None`/`[]` initializer with no annotation still needs one (T0015/T0003). There is no `Range` type yet, despite being described in `docs/design.md` — features that would naturally use it (e.g. `String.first()`/`.last()`/`.slice()`) use a documented crash-tier or two-`Int`-argument stand-in until it lands.

### Diagnostics (error) system

Two-phase, and this is the part most likely to trip you up:

1. **Collection** — every stage (lexer, parser, typechecker) accumulates raw `Marker`s (`{ code, span, data?, related? }`) as it runs; a `Marker` only carries a code and enough structured data to render a message later.
2. **Elaboration** — `src/errors/elaborate.ts`'s `elaborate(marker, source)` looks the code up in the generated `ERRORS`/`byCode` table (`src/errors/index.ts`, generated from `src/errors/*.yml` by `scripts/gen-errors.ts` / `npm run generate`) and fills in the human-facing `Diagnostic` (message, explanation, fix, example, related spans), substituting `{found}` (source text at the span) and any `data` keys into the templates.

`parse()`/`typecheck()` (the top-level, combined entry points) return already-elaborated `diagnostics: Diagnostic[]`. The lower-level per-stage APIs (`Lexer.tokenize()`, `parseTokens()`) still return raw `errorMarkers: Marker[]` — elaborate those yourself if you call them directly. `src/errors/render.ts` renders an elaborated `Diagnostic` for the terminal.

Error codes are namespaced by category, one YAML file per category, and are **append-only** — a code is never renumbered, reused, or deleted; retire one with `retired: true` instead:
- `L` lexical (`lexical.yml`) — the characters don't form valid Ascent
- `S` syntactic (`syntactic.yml`) — words are fine alone, don't fit together
- `N` name/binding (`name.yml`) — a name/slot rule is broken
- `T` type (`typechecker.yml`) — types don't line up
- `R` runtime (`runtime.yml`) — only running reveals it (overflow, division by zero, index out of bounds) — thrown as a `RuntimeError` (`src/errors/runtime-error.ts`) from the interpreter, a distinct bug-tier crash path from the T0006-style checked errors above

Diagnostic prose (`message`/`explanation` in the `.yml` files) is written for an absolute beginner: plain language, no compiler jargon (say `Int`/`Float`/`function`, not "token"/"literal"), states facts about the rule rather than guessing a fix, and only ships a machine-applicable `fix` when the correction is unambiguous.

### Entry points

- `src/index.ts` — the `ascent` CLI binary: run a `.asc` file (optionally binding declared `args` from `--flag value` pairs) or start the REPL.
- `src/lib.ts` — the public programmatic API (`@ascent-lang/dev`'s package entry), re-exporting the pipeline stages for embedders. Its header comment shows the intended one-call (`parse()` + `executeProgram()`) usage.

### Other directories

- `test-programs/*.asc` — small example programs, not wired into the test suite.
- `legacy/` — a superseded earlier prototype (not included in `tsconfig.json`, not built or tested); historical reference only.
