# Functions — implementation plan

Functions are the single biggest remaining feature of the language. Almost every
decision is already pinned down by the whitepaper
([docs/ascent-whitepaper.md](../docs/ascent-whitepaper.md) §2, §5, §7, §11), so
this is less open-ended than it looks — the work is disciplined plumbing across
the four pipeline stages, not new language design.

This plan is staged: **three stages, each shippable and testable end to end**
before the next begins, in the spirit of the existing
[typechecker-refactor.md](./typechecker-refactor.md) and
[interpreter-refactor.md](./interpreter-refactor.md).

## What "functions" means in Ascent (the constraints)

Pulled straight from the whitepaper — these are givens, not choices:

- **Functions are values, made *only* by `fix f = fn(params) -> Ret { body }`.**
  There is no `fn name(...)` declaration form (§5).
- **One body form: the block.** No arrow (`=>`) form — it was considered and
  removed (§5). The body yields the value of its last statement (the block-value
  rule, §2).
- **Signatures are fully explicit** — both parameter types *and* the return type
  are mandatory (§7, "inference lives only on slots"). This is load-bearing: a
  function's type is fully known from its syntax, so nothing is reconstructed
  from the body, errors stay local, and **recursion needs no special case**.
- **`return` is early-exit only** (§5), and is a *diverging* expression of type
  `Never` (§7) — it sits beside `abort` and the bad arm of `try` in the same
  bottom-type machinery.
- **Closures capture by value** — a closure snapshots the values of the outer
  names it uses *at the moment it is created*, capturing only the names it
  actually uses (§5). Later mutation of an outer `mut` slot must **not** be
  visible to the closure — the JS loop-footgun (`fn() { i }` built in a loop
  capturing `0, 1, 2`, never three views of a final `3`) is explicitly the
  behaviour we must produce.
- **Recursion via recursive `fix`**: `fix f = fn(...) { ... f(...) ... }` — the
  `fix` binding is in scope within its own initializer. The closure captures the
  *slot* `f`; because a function body runs at call time, the slot is filled by
  the time `f` calls itself (§5). **Mutual recursion is deferred** — it will get
  an explicit `rec { }` grouping form later, never silent hoisting.
- **`program (params) { body }` is already a function shape.** The whitepaper is
  explicit: "the entry point was their first function all along" (§11), and wants
  `type`s and `fix helper = fn(...)` bindings to sit *above* `program`.

## Current state of the pipeline

- [src/parser/index.ts](../src/parser/index.ts) parses `program (params){body}`
  into `Program { args, stmts }`; `args` are scalar-only
  ([ProgramArg](../src/parser/ast.ts), via
  [parseParam](../src/parser/type-expr.ts)).
- [call](../src/parser/ast.ts) nodes exist but `callee` is a bare **string**, and
  the checker only accepts `print` — the sole entry in the `FUNCTIONS` table
  ([src/check/signatures.ts](../src/check/signatures.ts)); any other name is
  T0013.
- [AscentType](../src/types/types.ts) has **no arrow type**;
  [TypeExpr](../src/parser/ast.ts) has **no function-type form**;
  [RuntimeValue](../src/interpreter/values.ts) has **no function value**.
- `Never` exists but only ever arises from `[]`; there are no diverging
  expressions yet.
- The checker ([src/check/](../src/check/)) has **no notion of an enclosing
  function's return type**.

---

## Stage 1 — Function values, types, and calls (the core)

> **Status: DONE.** Implemented across lexer → types → AST → parser → checker →
> interpreter → printers, with `test/functions.test.ts` (27 cases) and the full
> suite green (395 passing), `tsc --noEmit` clean. Two things surfaced during
> implementation and were handled:
> - **`Done` in type position.** `-> Done` (and any `Done` annotation) failed
>   S0010 because `Done` lexes as a value constructor (`DONE_LIT`), not a
>   `TYPE_NAME`. Fixed: `parseTypeExpr` admits `DONE_LIT` as the `Done` type, and
>   `formation.ts` maps the name `Done` → `DONE_TYPE`. Position disambiguates
>   (design.md §2), same as any type/constructor overlap.
> - **Calling a function that isn't a bare name is still deferred** (Decision 1).
>   `b.op(9)` (a function-typed *field*) parses as a *method* call and reports
>   T0012, since methods don't exist yet; the workaround is `fix op = b.op; op(9)`.
>   Free variable capture, recursion, higher-order params/returns, `Int→Float`
>   arg widening, `Never`-widening empty-list bodies, and cross-REPL-line closures
>   all work.

**Goal.** `fix double = fn(x: Int) -> Int { x * 2 }; double(5)` runs. Higher-order
*usage* works (`xs.map(double)`). Recursion works (factorial written with an
`if`-expression). Closures capture by value. **No `return` yet** — a body produces
its block value only; that is already enough for realistic functions.

### Types — [src/types/types.ts](../src/types/types.ts)
- Add `{ kind: 'Function'; params: AscentType[]; result: AscentType }`.
- `typeToString` → `fn(Int, String) -> Bool`.
- `typesEqual` → same arity, params pairwise equal, result equal.
- `subtype` → **invariant**: equal (witness `null`) or `false`. Keeping function
  types invariant honours §7's "no subtyping, no variance" — one fewer crack in
  the lattice. `Never <: Function` already falls out of the existing `Never`
  branch. A function value never needs a runtime coercion witness.
- `containsNever` — leave as-is. A fully-annotated signature never leaves an
  *unresolved* `Never` in a slot, so it needs no new recursion case.

### AST — [src/parser/ast.ts](../src/parser/ast.ts), [typed-ast.ts](../src/parser/typed-ast.ts)
- `TypeExpr` gains `{ kind: 'FnType'; params: TypeExpr[]; result: TypeExpr; span }`.
- New expression `{ kind: 'fn'; params: FnParam[]; returnType: TypeExpr; body: Block; span }`,
  with `FnParam = { name, nameSpan, type: TypeExpr, span }`.
- Keep `call` with `callee: string` (see **Decision 1**).
- Typed twins: `TypedFn { params: {name,type}[], returnType, body, captures: string[], type, span }`
  — `captures` (the free-variable list) computed by the checker for the
  interpreter — and the typed `call` node carries the resolved param/return types
  so the interpreter can coerce.

### Parser — [expr.ts](../src/parser/expr.ts), [type-expr.ts](../src/parser/type-expr.ts), lexer
- Lexer: add `KW_FN` (`fn`) and `KW_RETURN` (`return`) to
  [keywords.ts](../src/lexer/keywords.ts) + [token.ts](../src/lexer/token.ts).
  `return` is reserved now though it is only *used* in Stage 2.
- `parseTypeExpr`: `KW_FN` branch → `fn ( T, T ) -> R`.
- `parseAtom`: `KW_FN` → `parseFn` — `fn (params) -> Ret { body }`. Params via a
  new `parseFnParam` that uses the full `parseTypeExpr` (so a param may be
  `List<Int>`, `Person`, `Int?`, or itself a function type) — unlike the
  scalar-only program `parseParam`.

### Checker — [synth.ts](../src/check/synth.ts), [stmt.ts](../src/check/stmt.ts), [formation.ts](../src/check/formation.ts), [signatures.ts](../src/check/signatures.ts)
- [formation.ts](../src/check/formation.ts): `FnType` → `Function` type.
- New `synth` case `'fn'`: form the `Function` type from the signature; check the
  body in a child scope with the params bound (as `fix`); require
  `body.type <: result` (new **T0036**); compute `captures` (names used in the
  body but not bound by params or locals).
- `'call'` case: if `callee ∈ FUNCTIONS` → today's path (keeps `print`'s
  `Display`-bounded genericity untouched). Otherwise look up the slot binding:
  a `Function` type → check arity (T0007) + args (T0008), result is the
  function's `result`; a non-function binding → new **T0035** ("this name isn't a
  function, so it can't be called"); no binding → T0013 as today.
- **Recursion** — in `inferStmt` `fix`/`mut`, when the initializer is an `fn`
  literal, form its type from the signature and bind the name *before* checking
  the body. This falls straight out of explicit signatures.
- `==` / `!=`: reject `Function` operands (T0009). §5 forbids comparing functions;
  without this, two equal arrow types would slip through `leastCommonType` and be
  silently allowed.

### Interpreter — [interpreter.ts](../src/interpreter.ts), [values.ts](../src/interpreter/values.ts), [env.ts](../src/interpreter/env.ts)
- `RuntimeValue` gains
  `{ type: 'Function'; params: {name,type}[]; result; body: TypedBlock; closure: Environment }`.
- Evaluate `'fn'`: snapshot the `captures` from the current env into a fresh
  closure `Environment`. Add `Environment.snapshot(names)` that copies each
  binding's **value and mutability** (so a captured `mut` stays consistent with
  what the checker allowed inside the body). For `fix f = fn…`, **tie the knot** —
  inject `f`'s own function value into its closure so self-reference resolves at
  call time.
- `'call'`: `print` stays special; otherwise **apply** the function value — a new
  call env parented on the closure, params bound as `fix` (each arg coerced to its
  param type), run the body, coerce the result to the declared return type.
- Rendering: [printer.ts](../src/parser/printer.ts) /
  [typed-printer.ts](../src/parser/typed-printer.ts) and `valueToString` render a
  function as `fn(Int) -> Int`. A function has no `Display`, so `print`/
  interpolation of one is already blocked; this only covers a program whose final
  value happens to be a function.

### Errors (append-only)
- **S0031** — expected `->` and a return type in a function signature.
- **T0035** — this name isn't a function, so it can't be called.
- **T0036** — the function is declared to return `X` but produces `Y` (reused for
  the body value now, and for `return` in Stage 2).
- Arity and argument mismatches reuse **T0007** / **T0008**.

### Tests — `test/functions.test.ts`
Definition + call; arity/type errors; higher-order (`xs.map(double)` with a named
fn passed by slot ref); recursion (factorial); **closure value-capture** (the
loop-footgun snapshot — the defining behavioural test); invariant function types
(a `fn(Int)->Int` is not a `fn(Int)->Float`); `==`-on-functions error.

---

## Stage 2 — `return` (early exit)

> **Status: DONE.** `return` landed as a Never-typed expression across parser →
> checker → interpreter, with `T0037` (return outside a function) and 11 added
> tests (functions suite 38, full suite 406 passing, `tsc` clean). Notes:
> - **Block divergence.** `inferBlock` now types a block that contains a
>   diverging (`Never`) statement as `Never`, so an unreachable trailing value
>   after a `return` doesn't spuriously fail the return-type check
>   (`fn() -> Int { return 5; 99 }` is fine). This is the minimal reachability
>   needed; the unreachable-code *warning* is still deferred.
> - **Enclosing return type** is threaded on `TypeEnv` (`childForFunction` /
>   `enclosingReturn`), so a `return` in a nested function targets the inner
>   function, verified by test.
> - **Interpreter** uses a `ReturnSignal` thrown from the `return` case and
>   caught only at the application boundary; the value is coerced to the declared
>   return type at the throw site.

**Goal.** `fn(n: Int) -> Int { if (n < 0) { return 0 }; n * 2 }`.

- AST: `{ kind: 'return'; expr: Expr | null; span }` as an **expression** of type
  `Never`, so a block ending in `return` gets type `Never` and joins cleanly with
  sibling `if`/`match` branches (also what future `try` desugaring needs — §9's
  `Failure{ error } -> return Failure{ error }`).
- Checker: thread the enclosing function's declared return type on `TypeEnv`, set
  when entering an `fn` body (e.g. a `childForFunction(returnType)` variant of
  `child()`). `return e` requires `e.type <: enclosingReturn` (reuse **T0036**);
  `return` outside any function → new **T0037**. A bare `return` returns `Done`.
- Interpreter: `return` throws a `ReturnSignal`, caught at the function-application
  boundary; the value is coerced to the declared return type.
- Defer the "unreachable code after `return`" reachability warning.

### Tests
Early return; return-type mismatch; `return` outside a function (T0037); bare
`return` in a `Done`-returning function.

---

## Stage 3 — Unify `program` with functions

**Goal.** The appendix shape: `type`s and `fix helper = fn(...)` bindings above an
explicit `program { … }` (§11).

- Parser ([src/parser/index.ts](../src/parser/index.ts)): allow a leading run of
  **declarations** (`type`, and `fix`/`mut` whose initializer is an `fn` literal)
  before `program`. With an explicit `program`, a bare **executable** statement at
  the top level (a call, a computed binding) → new **S0032** ("execution lives
  only inside `program`"; a loose statement beside an explicit `program` would be
  a second, competing program). Adopt the no-paren `program { body }` form for the
  no-input entry point, and repurpose **S0029**'s prose so `program ()` says "drop
  the `()`" instead of "add an input". **S0030** (content after the block) stays.
- Program parameters stay **scalar-only** (§11 — they are a UI/boundary concern,
  distinct from `fn` params, which take any type). No AST unification of
  `ProgramArg` with `FnParam` is needed — only the surrounding top-level rules
  relax. Module imports remain deferred (no module system yet).
- Checker / interpreter: process the leading declarations into scope before the
  `program` body runs.

### Tests
Helper fn above `program`; `type` above `program`; loose statement beside
`program` → S0032; `program ()` → S0029 fix-it; `program { }` valid.

---

## Decisions

**1. Call syntax — name-based now, or call-any-expression?**
Recommend **`callee: string` (name-based)** for these stages. It matches every
call in the whitepaper (`double(5)`, `f(n - 1)`) and keeps `print`'s
`Display`-genericity clean. Higher-order *usage* still works, because a bare slot
reference not followed by `(` is already a `slot` node carrying a `Function` type
(`xs.map(double)`). The only thing it cannot do is call an expression *result*
directly — `getAdder(3)(4)`, `(fn…)(5)`, `funcs[0](x)` — which is rare in beginner
code and a clean follow-up (add an `apply` postfix, or migrate `callee` to `Expr`,
once `print` genericity is factored out). Power is opt-in and late (§principle 7).

**2. Explicitly out of scope** (deferred, consistent with the whitepaper):
methods / `self` (build-path stage 5, its own feature), `async`, generics/traits
beyond the existing hard-coded `Display`, **mutual recursion** (needs the `rec { }`
grouping form — §5), `abort`, and the eager **used-before-initialized**
self-reference error (`fix x = x + 1`, an N-tier refinement).

## Sequencing rationale

Stage 1 is self-contained and delivers the whole surface a first function lesson
needs. Stage 2 adds one orthogonal expression form and the first *real*-program
source of `Never`. Stage 3 is pure top-level restructuring that only becomes
meaningful *because* Stage 1 gives you helper functions to put above `program`.
Each stage keeps `npx tsc --noEmit` + `npm test` green before the next begins.
