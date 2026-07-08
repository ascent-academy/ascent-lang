# Interpreter refactor — plan

The interpreter ([src/interpreter.ts](../src/interpreter.ts)) is a solid handwritten,
pure tree-walking evaluator over the `TypedProgram`: `evaluateExpr` / `executeStmt` /
`evaluateBlock` are a big-step operational semantics (`ρ ⊢ e ⇓ v`), and the only
effect is throwing a `RuntimeError` on a §9 bug-tier crash. The *logic* is already
clean and well-commented. The problem is purely structural: it's **one 547-line file
holding about a dozen responsibilities** — exactly where [typechecker.ts](../src/parser/typechecker.ts)
was before [typechecker-refactor.md](./typechecker-refactor.md).

This is the companion to that plan and reuses the same philosophy: pure-win
extractions first, one principled representation change in the middle, module split
last. It differs in one way — because the checker refactor already landed, the
runtime now has a clear **twin** for most of its pieces (`TypeEnv` ↔ `Environment`,
`METHODS` table ↔ method dispatch, the type algebra ↔ a value algebra), so the target
shape isn't hypothetical: it's "make `src/interpreter/` structurally symmetric with
`src/check/`".

## The core problem

[interpreter.ts](../src/interpreter.ts) conflates things that change for different
reasons:

1. **The evaluation judgment** — `evaluateExpr` ([:122-224](../src/interpreter.ts#L122-L224)),
   `executeStmt` ([:235-265](../src/interpreter.ts#L235-L265)), `evaluateBlock`
   ([:226-233](../src/interpreter.ts#L226-L233)): the tree walk itself.
2. **The value domain** — `RuntimeValue` / `ScalarValue` ([:28-40](../src/interpreter.ts#L28-L40))
   plus everything that operates on a value regardless of the walk: `coerce`
   ([:87-92](../src/interpreter.ts#L87-L92)), `valuesEqual` ([:413-423](../src/interpreter.ts#L413-L423)),
   `formatFloat` ([:96-99](../src/interpreter.ts#L96-L99)), `scalarToString`
   ([:106-114](../src/interpreter.ts#L106-L114)), `graphemesOf` ([:119-120](../src/interpreter.ts#L119-L120)).
   This is a *value algebra* — the runtime twin of [types.ts](../src/types/types.ts) —
   written inline.
3. **The built-in library** — `evalMethodCall` ([:378-388](../src/interpreter.ts#L378-L388))
   and the four `eval*Method` dispatchers ([:269-376](../src/interpreter.ts#L269-L376)).
   This is *data about the language* (the runtime behaviour of each builtin) written
   as *control flow* — the same critique Phase 3 of the checker plan made, and which
   the checker has since fixed with its `METHODS` table while the interpreter has not.
4. **The numeric law (§4/§5)** — `checkIntOverflow` / `checkFiniteFloat`
   ([:12-26](../src/interpreter.ts#L12-L26)), `floorDivMod` ([:402-406](../src/interpreter.ts#L402-L406)),
   and `evaluateBinary` ([:427-484](../src/interpreter.ts#L427-L484)): the trap
   semantics that are most likely to be cited from design.md and least want to be
   buried mid-file.
5. **The scope chain** — `Environment` ([:51-82](../src/interpreter.ts#L51-L82)): the
   verbatim runtime peer of [check/env.ts](../src/check/env.ts)'s `TypeEnv`.
6. **The driver** — `ProgramInputs` ([:490-513](../src/interpreter.ts#L490-L513)),
   `RuntimeResult` ([:520-522](../src/interpreter.ts#L520-L522)), `executeProgram`
   ([:526-547](../src/interpreter.ts#L526-L547)): input binding and the top-level run
   loop, which is not the evaluator and shouldn't be the first thing a reader hits.

Separately — and this is the one latent-correctness smell — the subtyping **coercion
witness already encodes list recursion** (`Coercion = 'intToFloat' | { elem: Coercion }
| null`, [types.ts:93](../src/types/types.ts#L93)), but the interpreter's `coerce`
consumes only the top-level `'intToFloat'` case and **re-implements element recursion
by hand** at every list site (the `list` case at [:164-172](../src/interpreter.ts#L164-L172)
and `coerceElem` in `evalListMethod` at [:307-308](../src/interpreter.ts#L307-L308)).

## The principled lens: name the runtime twins

The evaluator is a big-step semantics; a clean tree-walker (Crafting Interpreters,
PLAI) keeps the **value domain**, the **store/environment**, the **evaluation
relation**, and the **primitive library** as separate concerns. Mapping the current
code onto them shows each piece already has a checker-side twin to mirror:

| Concern | Runtime form | Checker twin |
|---|---|---|
| value algebra (`⟦v⟧`) | `RuntimeValue`, `coerce`, `valuesEqual`, formatting, graphemes | [types/types.ts](../src/types/types.ts) |
| environment (`ρ`) | `Environment` | [check/env.ts](../src/check/env.ts) (`TypeEnv`) |
| evaluation (`ρ ⊢ e ⇓ v`) | `evaluateExpr` / `executeStmt` | [check/synth.ts](../src/check/synth.ts) + [check/stmt.ts](../src/check/stmt.ts) |
| primitive library | `evalMethodCall` + `eval*Method` | [check/signatures.ts](../src/check/signatures.ts) (`METHODS`) |
| numeric law (§4/§5) | overflow/finite guards, `floorDivMod`, `evaluateBinary` | — |
| driver | `executeProgram`, `ProgramInputs` | [check/index.ts](../src/check/index.ts) |

The target directory is simply that table made physical:

```
src/interpreter/
  values.ts     — RuntimeValue/ScalarValue, constructors, coerce, valuesEqual,
                  formatFloat, scalarToString, graphemesOf   (↔ types/types.ts)
  arithmetic.ts — checkIntOverflow, checkFiniteFloat, floorDivMod, evaluateBinary
  env.ts        — Environment                                (↔ check/env.ts)
  builtins.ts   — the runtime method table + evalMethodCall  (↔ check/signatures.ts)
  eval-expr.ts  — evaluateExpr                               (↔ check/synth.ts)
  eval-stmt.ts  — executeStmt, evaluateBlock                 (↔ check/stmt.ts)
  index.ts      — executeProgram, ProgramInputs, RuntimeResult; wires + re-exports
```

`eval-expr.ts` and `eval-stmt.ts` import each other (mutual recursion for `if` /
`block`, whose evaluation delegates to statement execution) — the *same* pattern
already accepted between `synth.ts` and `stmt.ts`, so it's not a new hazard.

## Guiding constraints

- **A real test suite now exists** (`test/**/*.test.ts` — `snippets`, `optional`,
  `never`, `string-methods`, `interpolation`, `multiline-strings`, all exercising
  `executeProgram` end-to-end). Unlike the checker refactor, which had only sample
  programs, here `npm test` is the safety net: **run it green after every phase.**
- **Behaviour-preserving throughout, with one exception.** Every phase must produce
  identical runtime values and identical `R####` crashes at identical spans — *except*
  Phase 2, which closes a latent nested-`List` coercion gap (a fix, not a
  reorganisation) and so ships with a new test that pins the corrected behaviour.
- **Keep the evaluator pure — `(expr, env) => RuntimeValue`.** It already is; the only
  effect is `throw RuntimeError`. Don't dilute that during the split. The one place it
  will eventually change (I/O) is named as a forward note, not built here.
- **`null` stays the "no node" value** (project convention). Nothing in this refactor
  introduces a new sentinel.
- **Preserve the public API.** [lib.ts](../src/lib.ts) re-exports `Environment`,
  `evaluateExpr`, `executeStmt`, `executeProgram`, `ProgramInputs`, and the
  `RuntimeValue` / `RuntimeResult` / `AssignResult` / `ScalarValue` types
  ([lib.ts:33-40](../src/lib.ts#L33-L40)). Point those re-exports at
  `interpreter/index.ts`; downstream (CLI, REPL, embedders) must not change.
- **Don't over-abstract.** No generic `Visitor<T>` / fold interface — `switch (node.kind)`
  is the house idiom on both the checker and interpreter sides and reads well. No
  effect monad, no DI container. Seven files is the target; do **not** split
  `values.ts` further into `equality.ts` / `display.ts` / `segmentation.ts` — those
  are facets of one value algebra.

---

## Phase 1 — the value algebra as its own module (pure win)

Extract everything that operates on a `RuntimeValue` independent of the tree walk into
`interpreter/values.ts`: the `ScalarValue` / `RuntimeValue` types
([:28-40](../src/interpreter.ts#L28-L40)), `coerce` ([:87-92](../src/interpreter.ts#L87-L92)),
`valuesEqual` + its `Numeric` / `isNumeric` / `asFloat` helpers
([:392-423](../src/interpreter.ts#L392-L423)), `formatFloat` ([:96-99](../src/interpreter.ts#L96-L99)),
`scalarToString` ([:106-114](../src/interpreter.ts#L106-L114)), and the grapheme
segmenter ([:119-120](../src/interpreter.ts#L119-L120)). This is the runtime twin of
[types.ts](../src/types/types.ts): everything about *values*, nothing about *walking*.

While here, add thin value constructors (`intVal`, `floatVal`, `strVal`, `boolVal`,
`NONE`, `DONE`) so the evaluator and the builtin table stop repeating `{ type: 'Int',
value: … }` literals — the same readability win `INT_TYPE` etc. give on the type side.
Pure extraction; no logic changes.

**Verify:** `npm test` green — the value model, equality across Int/Float, Float
formatting (`3.0`), and interpolation output are all covered by the existing suite.

---

## Phase 2 — consume the whole coercion witness (de-dup that also closes a gap)

`coerce` ([:87-92](../src/interpreter.ts#L87-L92)) handles only the top-level
`'intToFloat'` edge; list-element widening is re-implemented by hand in the `list`
case ([:164-172](../src/interpreter.ts#L164-L172)) and via `coerceElem` in
`evalListMethod` ([:307-308](../src/interpreter.ts#L307-L308)). But `subtype` already
returns a **fully recursive** witness (`{ elem: Coercion }` for lists,
[types.ts:133-136](../src/types/types.ts#L133-L136)). Consume it directly:

```ts
// values.ts — apply the runtime witness `subtype` produced. Recurses into
// lists so a nested widening (List<List<Int>> <: List<List<Float>>) is one
// call, not hand-rolled per level.
export const applyCoercion = (v: RuntimeValue, c: Coercion): RuntimeValue => {
  if (c === null) return v;
  if (c === 'intToFloat') return floatVal(Number((v as IntValue).value));
  // c = { elem }: v is a List; coerce each element by the inner witness.
  return { type: 'List', elements: (v as ListValue).elements.map(e => applyCoercion(e, c.elem)) };
};
```

Then a value site asks `subtype(sourceType, targetType)` once and applies the witness,
instead of matching on `Int` and recursing by hand. `coerce(v, targetType)` becomes a
thin wrapper (`applyCoercion(v, subtype(runtimeTypeOf(v), targetType) || null)`) or the
call sites pass the witness the checker could have attached to the typed node.

**Honesty — this is a fix, not just de-dup.** Because the current `coerce` is a no-op
on any non-`Int` value, a `List<List<Int>>` widened to `List<List<Float>>` through
`append` / `concat` leaves `bigint` elements sitting inside a value the type system
calls `List<Float>` — observably wrong the moment one is formatted or fed to Float
arithmetic. This is why the phase is *not* purely behaviour-preserving: it corrects
that path. Land it with a test that pins nested-list widening (both a literal and an
`append`/`concat` result), then run the suite.

**Verify:** new nested-`List<Float>` snippet asserts every element formats with a
decimal point; existing Int→Float list widening tests stay green.

---

## Phase 3 — the numeric law in one module (pure win)

Move `checkIntOverflow` / `checkFiniteFloat` ([:12-26](../src/interpreter.ts#L12-L26)),
`floorDivMod` ([:402-406](../src/interpreter.ts#L402-L406)), and `evaluateBinary`
([:427-484](../src/interpreter.ts#L427-L484)) into `interpreter/arithmetic.ts`. This
is the §4/§5 trap semantics — overflow traps, no NaN/Infinity, floored `div`/`mod`
with the `(a div b)*b + (a mod b) == a` identity, `INT_MIN div -1` overflow, negative
`**` crash. It's the module a reader cross-referencing design.md most wants to open on
its own, and the one whose invariants (`R0001`–`R0004`) are worth reading uninterrupted
by the tree walk. `evaluateBinary` stays a pure function of `(op, span, left, right)`.

**Verify:** `npm test` green — overflow, div-by-zero, negative-exponent, and mixed
Int/Float arithmetic crashes are all exercised by the snippet suite.

---

## Phase 4 — the environment on its own (pure win, trivial)

Move `Environment`, `Binding`, and `AssignResult` ([:42-82](../src/interpreter.ts#L42-L82))
to `interpreter/env.ts`, verbatim. It's already a clean, self-contained scope chain and
the literal runtime peer of [check/env.ts](../src/check/env.ts). Nothing depends on the
interpreter internals; this is a move, not a change.

**Verify:** shadowing, `while`-loop reassignment observed across iterations, and
immutable-slot handling stay green.

---

## Phase 5 — built-in methods as data, not control flow (the principled change)

This is the highest-leverage change and the direct parallel to the checker's Phase 3.
Today the runtime behaviour of every builtin is four hand-written dispatchers
(`evalIntMethod` / `evalFloatMethod` / `evalStringMethod` / `evalListMethod`,
[:269-376](../src/interpreter.ts#L269-L376)) — the same shape the checker *used* to
have before it became the [signatures.ts](../src/check/signatures.ts) `METHODS` table.
The cost is **double bookkeeping that can silently drift**: adding `String.padLeft`
means editing `check/signatures.ts` *and* adding a case to `evalStringMethod`, in two
files, with no compiler link between them. CLAUDE.md already advertises "adding a
builtin method means adding a table entry" — but that's only true on the checker side.

Give the runtime the same treatment: a table keyed the same way, holding the
implementation.

```ts
// builtins.ts — the runtime peer of check/signatures.ts's METHODS. The
// checker has already guaranteed receiver type, method name, and arity, so
// these lookups are total by construction and need no re-validation (the
// same "checker bails to Invalid before dispatch" guarantee signatures.ts
// relies on). resultType flows in only for the List methods that must
// coerce their elements to the widened element type.
type MethodImpl = (recv: RuntimeValue, args: RuntimeValue[], ctx: { span: Span; resultType: AscentType }) => RuntimeValue;

const METHOD_IMPLS: Partial<Record<RuntimeValue['type'], Record<string, MethodImpl>>> = {
  Int:   { toString: r => strVal(String(r.value)), toFloat: r => floatVal(Number(r.value)), abs: (r, _a, { span }) => … },
  Float: { … },
  String:{ … },
  List:  { … },
};
```

`evalMethodCall` collapses to one lookup-and-apply; the four `switch`es disappear.

**Decision required — how tightly to bind the two tables** (recommend the first):

- **(a) Two parallel tables, keyed identically** — `check/signatures.ts`'s `METHODS`
  stays; `interpreter/builtins.ts`'s `METHOD_IMPLS` mirrors its keys. Keeps the stages
  decoupled (the interpreter never imports the checker), matching the pipeline's
  existing boundaries. Drift risk drops from "two files, two shapes" to "two entries
  under the same key", and a single meta-test can assert every checker signature has a
  runtime impl and vice-versa. **Recommended** — small, honest, no coupling.
- **(b) One unified registry** — signature *and* implementation in a shared builtin
  module both stages import. Zero drift, but it couples `check/` and `interpreter/`
  and blurs the stage separation the rest of the pipeline is careful about. Reach for
  this only if the builtin set grows large enough that (a)'s duplication hurts.

**Verify:** every method exercised in `test/` (`string-methods`, list ops in
`snippets`, `Int.abs` overflow, `Float.min`/`max`) returns identical values and
crashes; add the signature↔impl coverage meta-test under option (a).

---

## Phase 6 — split the tree walk + driver (module split, last)

With values, arithmetic, the environment, and the builtin library extracted,
`evaluateExpr` / `executeStmt` / `evaluateBlock` are what's left — the pure evaluation
relation. Split them into `interpreter/eval-expr.ts` and `interpreter/eval-stmt.ts`
(mutually recursive, mirroring `synth.ts`/`stmt.ts`), and move `ProgramInputs`,
`RuntimeResult`, and `executeProgram` into `interpreter/index.ts` as the driver that
wires everything together and carries the `lib.ts` re-exports. Do this **last**: it's
only a clean cut once each concern above has already left the file, otherwise it just
scatters the same tangle across more files.

**Verify:** full `npm test` green; CLI (`npm run dev test-programs/hello.asc`) and the
REPL run identically; `lib.ts` exports unchanged.

---

## Forward note (not this refactor): the I/O seam

The evaluator is pure today because Ascent has no `print`/effects yet. When it does,
resist `console.log` inside the walk: thread an explicit output sink (an `IO` / writer
handle passed alongside `env`) so effects stay at a named boundary and the evaluator
stays testable as a value function. Phase 6's `index.ts` driver is where that handle
would be constructed and injected. Design the seam when the first effect lands — don't
build it now.

---

## Order of work & payoff

| Phase | Effort | Behaviour change | Payoff |
|-------|--------|------------------|--------|
| 1 value algebra (`values.ts`) | small | none | runtime twin of types.ts; value constructors kill literal noise |
| 2 consume coercion witness | small | **yes** (fixes nested-`List` widening) | de-dups witness application; closes a latent correctness gap |
| 3 numeric law (`arithmetic.ts`) | small | none | §4/§5 trap semantics readable in one place |
| 4 environment (`env.ts`) | trivial | none | verbatim peer of check/env.ts |
| 5 builtins as data (`builtins.ts`) | medium | none | separates "what builtins do" from "how a call dispatches"; ends checker↔runtime drift |
| 6 tree-walk split + driver | medium | none | modularity / SRP finish; symmetric with src/check/ |

Every phase but Phase 2 lands as a behaviour-preserving commit gated on a green
`npm test`; Phase 2 is a reviewed fix that ships with the test that pins it. Phase 5
carries the one real decision (parallel tables vs. unified registry). Phase 6 is the
payoff of the earlier extractions — cheap because they came first.
