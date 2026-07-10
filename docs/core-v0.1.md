# Ascent — Core v0.1 · Layer split & scope

> *Companion to `ascent-whitepaper.md` (§1–§13) and `ascent-frontiers.md` (§14–§16).*
> *This document does not add design — it **partitions** the settled design into two
> shippable layers and marks the boundary of the first release (Core v0.1). Every
> claim of "shipped" is checked against the current implementation and the passing
> test suite; every "deferred" traces to a whitepaper/frontiers section that already
> frames it as late or v2.*

---

## 0. The two layers — and the seam between them

Ascent's built-ins fall into two layers with different lifecycles, and the code
already enforces the split:

- **Layer 1 — the Language.** The lexer, parser, evaluator, and the type-system
  *rules* — **plus the built-in *vocabulary*: the types, their literal syntax, the
  constructors, and the operators.** This layer is **closed**: it changes only when
  the language changes. Whitepaper §10 states the principle directly — *"the built-in
  vocabulary … is not a function prelude; it is the language itself, ambient like
  grammar."* Code: `src/lexer/`, `src/parser/`, `src/check/` (rules), `src/interpreter.ts`,
  `src/types/types.ts`.

- **Layer 2 — the Standard Library.** The **methods and free functions** on the
  built-in types. This layer is a **growable, versioned catalog**: members are added
  without touching the core. Whitepaper §10 draws exactly this line —
  *"a minimal prelude — just `print` — is ambient; every other function is imported."*
  **In Core v0.1 this becomes structural, not just conceptual: the free-function stdlib
  is reached through `import` (§6 below), so the Layer-1/Layer-2 boundary is enforced by
  the module system.** Code: the method half is **two parallel data tables** —
  `METHODS`/`FUNCTIONS` (`src/check/signatures.ts`) and `METHOD_IMPLS`
  (`src/interpreter/builtins.ts`) — synced by a parity meta-test
  (`test/builtins-parity.test.ts`); the free-function half is delivered as importable
  stdlib modules.

**The seam (three welds).** A collection is really *type + literal/iteration syntax +
methods* at three depths (see §3's split of `List`). The type and its syntax are
Layer 1; the methods are Layer 2. The only places a Layer-2-flavoured capability is
*welded* into Layer 1 are the three **trait-shaped** rules that exist only because
traits/generics are v2:

| Weld | Today (v0.1) | v2 |
|---|---|---|
| `for x in xs` | intrinsic `Iterable` trait, hardcoded to `List` \| `Range` | user-implementable `Iterable` |
| `${}` interpolation, `print` arg | intrinsic `Display` trait, hardcoded to scalars (`Int`/`Float`/`Bool`/`String`) | user-implementable `Display` |
| `sort` / `min` / `max` | intrinsic `Comparable` trait, hardcoded to comparable scalars | user-implementable `Comparable` |

These are marked 🔒 below. All three are now **named intrinsic traits** in
`src/check/traits.ts` (the compiler-known, consumed-not-defined half of the trait
system, whitepaper §7): a fixed `satisfies` predicate over a fixed implementor set,
with no user `trait`/`implement` syntax yet. `Iterable` additionally carries an
**associated type** (`Item`, the element `for` binds) — the projection a real trait
system writes `<T as Iterable>::Item`, hardcoded here (`List<T>`→`T`, `Range`→`Int`).
So v2 buys user-defined implementors, not the mechanism — nothing to solve now,
only to *label*.

**Two decisions baked into this revision:**

- **User-defined `methods {}` is deferred to v2** (was a v1 candidate). User types are
  **pure data** — records, enums, unions — inspected by `match`, destructuring, field
  access, and `with`. Behaviour lives in **free functions** (`area(shape)`, not
  `shape.area()`), which the language already supports. Consistent with §6's existing
  v1 stance ("you cannot add methods to a type you don't own; built-in types ship their
  own"), now extended to your own types as well.
- **Modules are pulled into v1**, scoped to **standard-library delivery** — *consumer
  side only*. See §6.

**Decided — how built-in operations are exposed (Option A):**

- **Option A *(chosen)*** — collection/string/conversion operations stay **built-in
  methods** (`xs.map(f)`, `s.trim()`, `n.toStr()`): chaining survives, matches the
  whitepaper, already implemented. Modules deliver the **free-function** stdlib
  (`math`, `min`/`max`, `assert`); built-in methods remain ambient on their type.
- **Option B *(rejected)*** — exposing those operations as **imported free functions**
  (`map(xs, f)`) was considered and declined: it would make everything-imported uniform,
  but at the cost of method chaining, a wider divergence from the whitepaper, a reopened
  pipe-operator question, and shedding Layer 1's method-call dispatch (leaving only field
  access `.field` on the dot).

**Status legend**

- ✅ **shipped** — implemented and covered by tests
- ➕ **add for v0.1** — needed to close the core
- 🔒 **trait-gated** — ships *hardcoded* in v0.1, generalizes to a real trait in v2
- ⏭️ **deferred** — moves to a future version

---

## 1. The Core v0.1 boundary at a glance

| In Core v0.1 | Deferred to a future version |
|---|---|
| Single file *(+ stdlib imports)* | User-authored modules: `export`, relative-path files — §10 |
| Scalars, `List`, `Range`, `Optional`, `Result`, `Task` | `Map`, `Set`, `Ref` — §4 |
| `type` records / enums / unions *(pure data)* | **User `methods {}`** — §6 |
| `match`, destructuring, `with`, `try`/`??`/`abort` | `make {}` guards, `opaque type` — §6 |
| `async` / `await` single-task | Nurseries, combinators, channels — §8 |
| `program(...)` entry form | UI / MVU / `Element` / `Command` — §11 |
| **`import` from stdlib registry** | DSLs (`json`/`html`/`regex`) — §4 |
| Built-in method catalog + free-function stdlib modules | Traits / user-definable generics — §16 |
| Full diagnostics system; REPL (auto-print) | `:type`, formatter, test runner — §13 |

---

## 2. Layer 1 — Language Reference

Everything here is *language mechanics + vocabulary*. Section numbers are the
whitepaper's; "→ Layer 2" marks a paragraph that only *points at* a stdlib member.

| Whitepaper | Content | Code | Status |
|---|---|---|---|
| **§2** Lexical & syntax | braces, `;`, `#`/`#[ ]#` comments, identifiers + **casing rule**, mandatory braces, expression-oriented blocks (last-statement value), **`void` discard rule**, `!` async sigil | `src/lexer/`, `src/parser/` | ✅ |
| §2 | backtick reserved for DSLs | — | ⏭️ (reserve the char only) |
| **§3** Slots | `fix`/`mut`, no-default, reassign-fix (N0002) | parser + `src/check` | ✅ |
| **§4** Scalars *(vocabulary)* | `Int` (overflow trap), `Float` (NaN/Inf → error, digit-both-sides), `Bool`, `String` (single + `"""` + dedent + `${}`) | `src/types`, lexer, interp | ✅ |
| §4 | `Done` = `{}`, `None`, `T?`/`Optional` *(as a type)* | `src/types` | ✅ |
| §4 | `List<T>` *(type + literal + least-common-type inference + `List<Never>`)* | `src/check`, `src/types` | ✅ |
| §4 | `Range` `a..b` *(type + literal)* | ✅ | ✅ |
| §4 | `Map<K,V>` *(type + literal)* | — | ⏭️ |
| §4 | value semantics; `Ref<T>` | — | ✅ value-sem / ⏭️ `Ref` |
| §4 | string *methods*, DSL blocks | → Layer 2 / ⏭️ | — |
| **§5** Expressions & control flow | `if`/`else if`/`match`/`while`/`for…in`, word operators, `Int→Float` promotion, `/`·`div`·`mod`·`**`, precedence, `??` | `src/check`, `src/interpreter.ts` | ✅ |
| §5 | functions: `fn` value, `=>` + block bodies, `Fn` type, **value-capture closures**, **recursive `fix`**, `return` | ✅ | ✅ |
| §5 | `for`-loop iterability | intrinsic `Iterable` trait (assoc. type `Item`), hardcoded `List`\|`Range` | 🔒 (→ user `Iterable`) |
| **§6** Data model | `type` records / enums / multi-variant unions, construction, **field-access rule**, `match`, **irrefutable destructuring** (refutable → T0034), **`with`** (fields/index/nested) | parser + `src/check` + interp | ✅ |
| §6 | **user `methods {}` clause** | — | ⏭️ **v2** — behaviour via free functions |
| §6 | `make {}` guarded construction, `opaque type` | — | ⏭️ |
| §6 | built-in conversion + collection methods | → Layer 2 | — |
| **§7** Type system | nominal, **no subtyping**, `Never`, `Invalid`, empty-list `List<Never>`, slot-only inference, **bidirectional checking**, **narrowing-by-binding** | `src/check` | ✅ |
| §7 | intrinsic-trait *mechanism* (`satisfies` predicate + `Iterable`'s `Item` associated type) | `src/check/traits.ts` | ✅ (`Display`, `Comparable`, `Iterable`) |
| §7 | `!= None` flow-narrowing | `match`/`??` cover it | ➕ optional |
| §7 | user-definable generics / traits | — | ⏭️ |
| **§8** Async | `async fn`, `f!()` → `Task<T>`, `await` (colored, enforced) | `src/check`, interp | ✅ |
| §8 | nurseries, `start`, combinators, channels | — | ⏭️ |
| **§9** Errors | two-tier model; `Optional`/`Result`/`orfail`, `try`, `try…else`, `??` (Optional-only) | `src/check`, interp | ✅ |
| §9 | **`abort "reason"`** *(Never-typed expression)* | lexer, `src/parser`, `src/check`, interp | ✅ |
| §9 | `.orAbort(msg?)` | → Layer 2 (method) | ✅ |
| §9 | Diagnostics: codes, categories, elaborate, beginner prose | `src/errors/` | ✅ |
| **§10** Modules | **`import` (named + namespace) from a compiler-known stdlib registry** | `src/parser`, `src/check/stdlib.ts`, `src/interpreter/stdlib.ts` | ✅ |
| §10 | `export`, relative-path user files, resolver | — | ⏭️ (user-authored modules) |
| **§11** Entry | **`program (params) { body }`** entry form (+ CLI arg binding) | `src/index.ts`, parser | ✅ |
| §11 | UI / MVU / `Element` / `Command` / subscriptions | — | ⏭️ |
| **§12–§13** | impl notes; tooling (`:type`, formatter, test runner) | REPL ✅ | infra / ⏭️ |

**Layer-1 work remaining for v0.1:** none required — the two remaining language
mechanics, **`abort`** (the `Never`-typed expression) and **stdlib `import`**
(consumer side, registry-resolved, both named and namespace forms), are now
shipped. Optionally `!= None` narrowing. `methods {}` is **out** — deferred to
v2. Everything else in Layer 1 is shipped.

---

## 3. Layer 2 — Standard Library catalog

The growable layer. **Methods** stay ambient on their built-in type (Option A). **Free
functions** are reached through `import` from a stdlib module (§6). `print` is the one
ambient free-function exception.

### The module system (v1 scope) — ✅ shipped

- **Syntax (both §10 forms):** `import { min, max } from "math";` (named, used bare) and
  `import math from "math";` (namespace, used `math.min(...)`). ✅
- **Resolution:** module specifiers name entries in a **compiler-known stdlib registry**
  — no filesystem, no path resolution. A fixed set of blessed module names. ✅ Both
  import forms resolve to one typed `call` node carrying its `module`, so the
  interpreter dispatches every stdlib call through one path (`evalModuleCall`); an
  unknown module is N0014, an unknown export N0015, a namespace misused as a value
  N0016. The two registry tables (`MODULE_SIGS` / `MODULE_IMPLS`) mirror the
  METHODS/METHOD_IMPLS pattern, pinned by a parity meta-test.
- **Deferred:** `export`, relative-path user files (`"./x.ascent"`), circular-import
  handling, external/bare packages — all arrive with *user-authored* modules later.
- **Ambient prelude:** `print` only (unchanged).

### Free-function stdlib modules (initial catalog — growable)

| Module | Members | Status |
|---|---|---|
| `math` | `min`, `max` (🔒 `Comparable`, scalar-hardcoded), `sqrt`, `floor`, `ceil`, `round` | ✅ starter set (`pow` ⏭️ — `**` covers it) |
| `assert` | `assert(cond: Bool)`, `assertEqual(a, b)` | ✅ (§13 on-ramp) |
| *(ambient)* `print` | `print<T: Display>(value: T) -> Done` | ✅ 🔒 `Display` |

### Built-in methods (ambient on their type)

#### `Int` / `Float`

| Member | → | Status |
|---|---|---|
| `toStr` | `String` | ✅ *(shipped as `toString`; rename to §6 `toStr`)* |
| `toFloat` (Int) / `toInt` (Float) | `Float`/`Int` | ✅ |
| `abs` | same | ✅ |

#### `String`

| Member | → | Status |
|---|---|---|
| `length` | `Int` | ✅ |
| `first` / `last` | `String?` | ✅ |
| `chars` | `List<String>` | ✅ |
| `slice(Range)` | `String` | ✅ (R0006 on bad bound) |
| `repeat(Int)` | `String` | ✅ (R0007 on negative) |
| `trim` / `padLeft(Int)` | `String` | ✅ |
| `split` / `join` / `concat` / `contains` / `toUpper` / `toLower` / `codePoints` / `bytes` | — | ⏭️ growable |

#### `List<T>`

| Member | → | Status |
|---|---|---|
| `length` / `isEmpty` / `reverse` | `Int`/`Bool`/`List<T>` | ✅ |
| `append(T)` / `prepend(T)` / `concat(List<T>)` | `List<T>` | ✅ |
| `[i]` *(language syntax, not a method)* | `T`, crash OOB | ✅ (Layer 1) |
| `map(Fn(T)->U)` / `filter(Fn(T)->Bool)` / `reduce(...)` | `List<U>`/`List<T>`/`U` | ➕ **add for v0.1** |
| `find(Fn(T)->Bool)` / `at(Int)` | `T?` | ➕ **add for v0.1** |
| `contains(T)` | `Bool` | ➕ 🔒 (`Equatable`, scalar-hardcoded) |
| `insert` / `remove` / `slice(Range)` | `List<T>` | ➕ or ⏭️ growable |
| `sort` / `min` / `max` | `List<T>` / `T` | 🔒 scalar-hardcoded; → `Comparable` in v2 |

#### `Range`

| Member | → | Status |
|---|---|---|
| `length` / `toList` / `contains(Int)` | `Int`/`List<Int>`/`Bool` | ✅ |

#### `Optional` / `Result`

| Member | → | Status |
|---|---|---|
| `.orAbort(msg?)` | `T` (else bug-crash) | ✅ — pairs with `abort` (§9) |

---

## 4. The must-add list to reach v0.1 (by layer)

**Layer 1 (language work):**
1. ✅ **`abort "reason"`** — a `Never`-typed expression; unblocks the §7 `Never`
   narrative and impossible-arm handling.
2. ✅ **Stdlib `import`** — parses both `import` forms; resolves specifiers against a
   compiler-known stdlib registry; injects named / namespace bindings into the checker
   scope, both resolving to one `call` node the interpreter dispatches. `export` + user
   files deferred.

**Layer 2 (catalog):**
3. `List` methods: `map`, `filter`, `reduce`, `find`, `at`, `contains` — closes the
   loop/`void` teaching story (**T0058 already tells users to use `.map`**). Pure table
   growth (`METHODS` + `METHOD_IMPLS` + parity test).
4. ✅ `.orAbort()` on `Optional`/`Result` (with #1).
5. Reconcile `toString` → **`toStr`** (match whitepaper §6).
6. ✅ Starter stdlib modules: `math` (`min`/`max`/`sqrt`/`floor`/`ceil`/`round`), `assert`
   (`assert`/`assertEqual`).
7. *(hardcoded now)* `sort`/`min`/`max` for scalar elements — 🔒.
**Consistency fixes (no new feature):**
- T0058's message references `.map` — resolved by #4.
- `toString`/`toStr` naming — resolved by #6.

**No longer in the list** (moved to v2): 

- user `methods {}` on types
- `!= None` flow-narrowing sugar.

---

## 5. What "closed vs. growable" buys you

- **Layer 1 can be frozen and specified once.** After `abort` + stdlib `import` land,
  the Language Reference is stable — a learner (and a future Rust port) reads it
  top-to-bottom.
- **Layer 2 grows without version churn.** Every method or stdlib-module function added
  later is a catalog entry, not a language change — so "keep the stdlib thin for v0.1,
  expand after" costs nothing structurally.
- **The module boundary makes the split physical.** With the free-function stdlib
  reached only through `import` (and just `print` ambient), Layer 2 is a genuinely
  separate unit — exactly the separation this document exists to draw. User-authored
  modules later reuse the same `import`, adding only `export` + file resolution.
- **The seam is already labelled.** When traits land (v2), the three 🔒 welds
  (`for`→`Iterable`, `${}`→`Display`, `sort`→`Comparable`) generalize *with no change to
  what any existing program means* — the whitepaper's stated guarantee.
