# Type checker & type system refactor — plan

The type checker ([src/parser/typechecker.ts](../src/parser/typechecker.ts)) is a
solid handwritten, error-recovering, **elaborating** checker: it walks the untyped
AST and produces a typed one with an inferred `type` on every node. It already has
the bones of a modern **bidirectional** checker — it just hasn't named them. This
plan turns it from **one 400-line file with four responsibilities** into a set of
small pieces organised around the standard typing *judgments*, without changing the
language it accepts (except Phase 5, which is an intentional behavioural upgrade).

It's the companion to [parser-refactor.md](./parser-refactor.md) and reuses the same
philosophy: pure-win extractions first, one principled representation change in the
middle, the behavioural change gated behind its own decision, module split last.

## The core problem

[typechecker.ts](../src/parser/typechecker.ts) conflates four things that change for
different reasons:

1. **The typing rules** — `inferExpr` / `inferStmt` / `inferBlock` / `inferIf`, the
   judgments themselves.
2. **The built-in signature environment** — `intMethodType`, `floatMethodType`,
   `listMethodType`, and the `floor` special-case. This is *data about the language*
   written as *control flow*.
3. **Error accumulation** — a `Marker[]` threaded through every function, plus the
   `T | null` propagation and `failed` flags. This is the identical tangle Phase 4
   of the parser plan calls out.
4. **Type formation** — turning syntactic `TypeExpr` / `ArgType` into a semantic
   `AscentType` (`resolveTypeExpr` + the inline arg mapping), scattered across three
   spots.

Separately, [types.ts](../src/types/types.ts) is a cohesive *type algebra* — but the
**subtyping rule lives in three places** (`leastCommonType`, `isAssignableTo`, and
the interpreter's `coerce`) that can silently drift.

## The principled lens: name your judgments

Modern checkers are organised around a handful of **judgment forms** from type
theory. Mapping the current code onto them shows exactly what's missing:

| Judgment | Meaning | Where it lives now |
|---|---|---|
| `⊢ T type` (formation) | is this a well-formed type? | `resolveTypeExpr` + inline arg mapping — scattered, partial |
| `S <: T` (subtyping) | does S fit where T is wanted? | `isAssignableTo`, derived from the join |
| `S ⊔ T` (join) | least common supertype | `leastCommonType` |
| `Γ ⊢ e ⇒ T` (**synthesis**) | infer e's type | `inferExpr` |
| `Γ ⊢ e ⇐ T` (**checking**) | check e against an expected T | the `contextType` param — half-built |

The last two are the heart of it.

## Guiding constraints

- **Behaviour-preserving through Phase 4.** Phases 1–4 must accept and reject exactly
  the same programs, with the same diagnostic codes at the same spans, as today.
  Phase 5 deliberately changes observable output (always emits a typed tree; may
  surface more errors per run) and is gated behind its own decision.
- **No test suite exists yet** (`npm test` is a stub). Verify each phase by running
  the sample programs — `npm start test-programs/hello.asc`, `test-programs/age.asc`
  — and by adding deliberately-ill-typed snippets that should still produce the
  *same* `T####` / `N####` codes as before. Landing a minimal checker test harness
  first is worth considering if this is going to be ongoing.
- **`null` stays the "no node" value** (per project convention). Phase 5 changes how
  *type failures* propagate (via an Error type), not what a missing node is.
- **Elaboration-during-checking is intended, not an SRP violation.** `synth` building
  the `TypedExpr` as it goes is exactly how real elaborating checkers work; don't
  split "check" from "produce the typed node".

---

## Phase 1 — type formation as one total judgment (pure win, no decision)

Turning source syntax into a semantic type happens in three unrelated spots:
`resolveTypeExpr` ([:32-45](../src/parser/typechecker.ts#L32-L45)), the arg-type
mapping inside `typecheck` ([:387-393](../src/parser/typechecker.ts#L387-L393)), and
the literal→type cases inside `inferExpr`. The first even has a **latent fall-through**:

```ts
case 'TypeName': {
  switch (te.name) {
    case 'Int': return INT_TYPE;
    // …no default, no trailing return…
  }
}
case 'ListType':                       // an unexpected name falls in HERE
  return listOfType(resolveTypeExpr(te.elem));   // …and reads a missing .elem
```

It's safe *today* only because the parser guarantees the `'Int' | 'Float' | 'Bool' |
'String'` union — "safe by luck, in another file". Give the formation judgment its
own name and make it total:

```ts
// ⊢ T type  — the only place a name becomes a semantic type.
const typeFromName = (name: TypeName['name'] | ArgType): AscentType => {
  switch (name) {
    case 'Int': return INT_TYPE;
    case 'Float': return FLOAT_TYPE;
    case 'Bool': return BOOL_TYPE;
    case 'String': return STRING_TYPE;
  }
};

const typeFromExpr = (te: TypeExpr): AscentType =>
  te.kind === 'TypeName' ? typeFromName(te.name) : listOfType(typeFromExpr(te.elem));
```

The arg loop in `typecheck` collapses to `env.set(arg.name, typeFromName(arg.type),
false)`, deleting the nested ternary at [:388-392](../src/parser/typechecker.ts#L388-L392).

**Verify:** annotated declarations (`fix x: List<Int> = …`) and program args resolve
to the same types; sample programs unchanged.

---

## Phase 2 — one subtyping relation, single source of truth (pure win, de-dup)

The rule "Int widens to Float, lists widen covariantly" is encoded three times:
`leastCommonType` ([types.ts:40-58](../src/types/types.ts#L40-L58)), `isAssignableTo`
([types.ts:62-65](../src/types/types.ts#L62-L65)), and the interpreter's `coerce`
([interpreter.ts:60-65](../src/interpreter.ts#L60-L65)). Nothing stops them drifting.

Make **subtyping the primitive, and let each subtyping fact carry the coercion that
witnesses it** — then derive the join and feed the coercion to the interpreter:

```ts
// A coercion is the runtime witness of a subtyping edge: how to turn a value
// of the sub-type into one of the super-type. `null` = no coercion needed.
export type Coercion = 'intToFloat' | { elem: Coercion } | null;

// S <: T. Returns the witnessing coercion, or `false` when S is not a subtype.
export const subtype = (sub: AscentType, sup: AscentType): Coercion | false => {
  if (typesEqual(sub, sup)) return null;
  if (sub.kind === 'Int' && sup.kind === 'Float') return 'intToFloat';
  if (sub.kind === 'List' && sup.kind === 'List') {          // covariant
    const c = subtype(sub.elem, sup.elem);
    return c === false ? false : { elem: c };
  }
  return false;
};
```

`isAssignableTo` becomes `subtype(from, to) !== false`; `leastCommonType` stays as
the join but is the *only* other rule that knows about widening; and the interpreter's
`coerce` consumes the `Coercion` instead of re-deriving `Float && Int`.

**Why this matters beyond de-dup:** your lists are covariant (`List<Int> <:
List<Float>`), which is **only sound because Ascent lists are immutable** —
`append`/`prepend`/`concat` return new lists. That load-bearing invariant currently
lives only in your head; a named `subtype` is where it becomes reviewable, and it's
where `None`/`Done` will get a subtyping story when options eventually arrive.

**Touches:** [types.ts](../src/types/types.ts), the interpreter's `coerce`, every
`isAssignableTo` / `leastCommonType` call site (unchanged behaviour).

**Verify:** `fix x: Float = 3`, `fix xs: List<Float> = [1, 2]`, `==`/`!=` across
Int/Float, `if`-branch joins — all identical; the interpreter still widens Int→Float
element-wise in list literals.

---

## Phase 3 — built-in signatures as data, not code (pure win)

`intMethodType` / `floatMethodType` / `listMethodType`
([:54-96](../src/parser/typechecker.ts#L54-L96)) and the `floor` special-case
([:125-133](../src/parser/typechecker.ts#L125-L133)) are a **signature environment**
written as three hand-rolled dispatchers. Every method call re-runs bespoke control
flow to answer a data question: "what is the signature of `Int::abs`?"

Turn it into one table. Monomorphic methods are pure data; the three
element-dependent list methods keep a tiny resolver:

```ts
type MethodSig =
  | { params: readonly AscentType[]; result: AscentType }                     // mono
  | { arity: number; result: (recv: AscentType, args: AscentType[]) => AscentType | null };

const METHODS: Partial<Record<TypeKind, Record<string, MethodSig>>> = {
  Int:   { toStr: { params: [], result: STRING_TYPE }, toFloat: { params: [], result: FLOAT_TYPE }, abs: { params: [], result: INT_TYPE } },
  Float: { toStr: { params: [], result: STRING_TYPE }, toInt:   { params: [], result: INT_TYPE },   abs: { params: [], result: FLOAT_TYPE } },
  List:  {
    length: { params: [], result: INT_TYPE },
    isEmpty:{ params: [], result: BOOL_TYPE },
    reverse:{ params: [], result: /* List<elem> */ … },
    append: { arity: 1, result: (recv, args) => /* join(elem, args[0]) → List */ … },
    // prepend, concat …
  },
};
```

The `methodCall` rule becomes one uniform lookup-and-apply that raises `T0012`
(no such method), `T0014` (arity), `T0015` (arg type) in one place — instead of each
dispatcher re-implementing arity/arg checks. "What methods exist" (data, grows when
you add a builtin) is now cleanly separate from "how a method call is checked" (the
rule, essentially fixed). Fold `floor` in as an ordinary entry in a `FUNCTIONS` table.

**Verify:** every method in `test-programs/` and a snippet exercising `T0012`/`T0014`/
`T0015` produce identical codes and result types.

---

## Phase 4 — bidirectional: split `synth` (⇒) from `check` (⇐) (the principled change)

`inferExpr`'s fourth parameter `contextType`
([:104-106](../src/parser/typechecker.ts#L104-L106)) is a *checking* mode bolted onto
synthesis. It's threaded everywhere but consulted in only two spots (empty-list at
[:194](../src/parser/typechecker.ts#L194), list-widening at
[:218](../src/parser/typechecker.ts#L218)). Meanwhile the real checking judgment is
inlined by hand in `fix`/`mut`
([:322-329](../src/parser/typechecker.ts#L322-L329)): "infer the init, then compare
to the annotation with `isAssignableTo`". That is textbook **bidirectional typing**
(Dunfield & Krishnaswami, 2021) — make it explicit:

```ts
// Γ ⊢ e ⇒ T   — no expectation; produce a type.
const synth = (e: Expr, env: TypeEnv, diag: Diagnostics): TypedExpr | null => { … }

// Γ ⊢ e ⇐ T   — an expected type flows in; verify e conforms.
const check = (e: Expr, expected: AscentType, env: TypeEnv, diag: Diagnostics): TypedExpr | null => {
  // Default rule, covering almost every form: synthesize, then require  synth(e) <: expected.
  // A few forms OVERRIDE it:
  //   • empty list []  — adopt `expected` as the list type          (was :192-199)
  //   • list literal    — push expected.elem into each element        (was :218-221)
  //   • if / block      — check each branch against `expected`
};
```

The three scattered special cases stop being scattered special cases — they *are* the
definition of `check` for those forms. The annotation logic in `fix`/`mut` becomes
`check(init, annotation, …)`. `contextType` disappears as a pass-through parameter.

This is the change that most improves "principled": the check-vs-infer distinction
stops being an optional argument most callers ignore, and becomes the two judgments
real checkers are built from. Behaviour is identical — it's a representation change.

**Verify:** `fix x: Float = 3` (Int checked against Float), `fix xs: List<Float> =
[1,2]` (elements pushed to Float), empty-list-needs-annotation (`T0003`),
annotation-mismatch (`T0001`), and `if`/`while` branch typing all unchanged.

---

## Phase 5 — diagnostics sink + Error type (behavioural upgrade, own decision)

**Decision required before starting.** Today two things are tangled and painful:

- `markers: Marker[]` is threaded through every function.
- Every rule returns `T | null` and does `if (x === null) return null`, and
  list/block/program each re-implement the same accumulate-and-continue loop with a
  `failed` flag ([:202-207](../src/parser/typechecker.ts#L202-L207),
  [:238-244](../src/parser/typechecker.ts#L238-L244),
  [:275-285](../src/parser/typechecker.ts#L275-L285)).

Two moves, one behaviour-preserving and one not:

**(a) A `Diagnostics` sink object** replacing the passed-around `Marker[]` — the same
extraction as the parser plan's error accumulator. Pure win, land it first.

**(b) An `Error` (a.k.a. `Unknown`) member of `AscentType`.** Standard practice
(TypeScript's `errorType`, GHC's deferred errors): a failed sub-expression yields the
Error type, which is `<:` everything and everything is `<:` it, so it neither cascades
new errors nor forces the parent to bail. Inference then **never returns null** — all
the `| null` returns and `failed` flags collapse, and `typecheck` can **always emit a
typed tree** instead of throwing it away on the first error
([:402-405](../src/parser/typechecker.ts#L402-L405)), which is what editor tooling
will want.

**Tradeoff / honesty:** `null`-propagation already suppresses cascades correctly
today, so the pitch for the Error type is *removing the threading* and *keeping the
tree*, **not** fixing a cascade bug. It does change observable output: programs that
currently stop at the first type error may now surface more, and a typed tree exists
where before there was `null`. That's why it's gated and reviewed on its own.

**Recommendation:** land the `Diagnostics` sink early (with Phase 1 if convenient),
and do the Error type as its own reviewed change after Phase 4.

**Verify:** single-error programs report the same code at the same span; a program
with two independent type errors now reports both; a well-typed program produces a
byte-identical typed tree and runs identically.

---

## Phase 6 — split into modules (cosmetic; only after 1–5)

Once the judgments and the signature table are separated, the seams are obvious and
mirror how large checkers (rustc's `rustc_typeck`, the TypeScript checker) are laid
out:

- `types/` — the algebra: `AscentType`, `TypeKind`, `subtype` (+ `Coercion`), `join`,
  `typesEqual`. Optionally split `typeToString` out as presentation.
- `check/env.ts` — `TypeEnv` (already clean,
  [:14-30](../src/parser/typechecker.ts#L14-L30)).
- `check/formation.ts` — `typeFromExpr` / `typeFromName` (Phase 1).
- `check/signatures.ts` — the `METHODS` / `FUNCTIONS` tables (Phase 3).
- `check/synth.ts` + `check/check.ts` — the two judgments (Phase 4).
- `check/diagnostics.ts` — the sink (Phase 5).
- `check/index.ts` — wires them together, exposes `typecheck()`.

Do it **last** — it's only clean once each rule has shrunk to its actual content.
Doing it first just scatters the boilerplate across more files.

---

## Order of work & payoff

| Phase | Effort | Behaviour change | Payoff |
|-------|--------|------------------|--------|
| 1 type formation | small | none (fixes latent fall-through) | one total judgment, three call sites |
| 2 one `<:` relation | small | none | subtyping can't drift; covariance invariant made explicit |
| 3 signatures as data | medium | none | separates "what builtins exist" from "how calls check" |
| 4 synth / check split | medium | none | the principled core; folds 3 special cases into `check` |
| 5 diagnostics + Error type | medium | **yes** (always emits a tree; more errors/run) | deletes `\|null` threading + `failed` flags; tooling-ready |
| 6 module split | medium | none | modularity / SRP finish |

Phases 1–4 can land as behaviour-preserving commits. Phase 5's sink half is a pure
win; its Error-type half is a separate, reviewed change. Phase 6 is the payoff of the
earlier extractions.
