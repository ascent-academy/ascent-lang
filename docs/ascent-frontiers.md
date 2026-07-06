# Ascent — Design Frontiers

### Companion to the Design Whitepaper · v1 (draft)

> *Everything **beyond the settled core** of Ascent: scope boundaries (§14), open questions and the standard-library build plan (§15), and forward design for traits & generics (§16). The settled language — decided features and their reasoning — is in **`ascent-whitepaper.md`** (§1–§13); the trait system's full open-questions inventory is in **`traits-open-questions.md`**. Section numbers continue from the whitepaper, so a cross-reference like "(§16)" there resolves here, and "(§6)" here resolves in the whitepaper.*

---

## 14. Out of scope

**No inheritance, no subtyping — Ascent is not class-based OOP, and never will be.** It *does* have methods (§6), but classes, inheritance, and subtype hierarchies are out for good, not just in v1. This is settled on principle: they would require subtyping, and the entire type system's simplicity (§7) rests on *not* having it — so adding them later wouldn't be a feature, it would be tearing out the foundation. Methods deliver the object-like *feel* — and real method chaining — without any of it, exactly as Rust's and Go's structs do. Shared behavior, if it ever comes, arrives as trait-style contracts that need no subtyping.

**Deferred** — a "later module," introduced when a learner asks the question it answers: interfaces / typeclasses (traits) · user-definable generics · exceptions · operator overloading · default / named arguments · placeholder sections (`T{ field: _ }` as a function, with partial application) · varargs · comprehensions · getters / setters · decorators · macros · tuples · `Set` · `Char`.

---

## 15. Open questions & backlog

The conceptual core is closed — values, slots, the numeric model, expressions, the data model (§6), the type-system spine (§7), strings, `args`, the block-value rule, and the full error model (§9) cohere, and recent questions have resolved *from* these principles rather than forcing new ones. What remains is a different character of work, grouped below by kind rather than as one sequential list. The implementation itself (the build-log, growing the interpreter one capability at a time) is the parallel execution track, separate from these design questions.

### Design frontiers — genuine design left

- **UI / effects model — core decided (§11), edges open.** The architecture is settled: pure `view`/`update` returning `Element`/`Command` values, a runtime loop that performs effects via structured-concurrency tasks, subscriptions as model-scoped structured concurrency, failures re-entering as messages. Still open: what a `Command` *is* (a closed built-in set the runtime knows — the v1 answer — versus an open, user-extensible kind, which brushes traits); **composability** — nested view/update with local state, the *React-transfer-critical and retrofit-hard* property the design must honor from the start.
- **Structured concurrency (nurseries) — model decided (§8), mechanics pending.** Decided: a *nursery* is the owner-node of its child tasks (a stack frame for concurrency) — a block that is also a passable first-class `Nursery` value, with `start` as a method so nothing spawns without one; its three responsibilities are wait / propagate-failure-and-cancel-siblings / own-cancellation, and result-collection is deliberately *not* one; one fail-fast error policy, with all combinators (`all`/`gather`/`race`/`any`) as library functions that transform tasks and loop over completions (proven complete over the primitive). Pending mechanics: the completion surface (imperative pull `nextCompletion` vs. a **channel** of completions), whether **channels** enter the language at all (they would also serve the dynamic-*and*-collecting case), how `start` returns a result/handle, cancellation semantics, and multi-failure aggregation.
- **Widget vocabulary.** The minimal `Element` set — genuinely library content, writable once the effects substrate above exists.
- **Compile-time-validated DSLs — `json` decided (§4), notation set, interpolation + `html` open.** Decided: a *closed, compiler-curated* set of tagged fenced-backtick blocks (inline `` json`...` ``, block triple-fence, Markdown fence-escalation), **off by default and switched on per-file by import**, each a compile-time validator paired with a runtime library; `json` produces a runtime `Json` value (nominal union, *not* structural shapes) with `.decode(NominalType)` as the runtime boundary; no general macro system, no third-party compiler code. Open: **DSL interpolation** — typed, DSL-aware, auto-escaping `${}` holes (it interacts with both compile-time validation and injection safety, so it is *not* plain string splicing); **`html` → `Element`** as the UI-authoring surface (Ascent's JSX), designed *with* the UI frontier; and the compiler architecture (embedded per-format validators, source-position-accurate diagnostics into the block).

### Standard library — mostly effort, some trait-gated

- **Collections — build concrete, extract traits later (the anti-over-engineering rule).** The collection systems people love (Rust's) were *grown from concrete types with the trait extracted*; the ones they regret (Scala's early hierarchy, rewritten in 2.13) were *designed top-down first*. So the plan is explicitly **grow, don't design up front** — the hierarchy is a north star, not a starting point:
  - **Phase 1 (now, no traits): `List<T>` as a concrete built-in.** A persistent data structure with structural sharing (§12 — start with a persistent vector, RRB-tree later; swappable without semantic change). `for x in xs` is hard-coded for `List` (it is the eventual `Iterable` desugar target, concrete for now). Methods are base-verb / returning (§6): `map`, `filter`, `reduce`, `find`, `contains`, `append`, `insert`, `remove`, `first` / `last` (→ `T?`, `None` on empty), `at` (→ `T?`) and `[i]` (→ `T`, crash-out-of-bounds, §9), `length`, `isEmpty`, `reverse`, `slice`, `concat`, and — hard-coded for the built-in comparable elements (`Int` / `Float` / `String` / `Bool`) — `sort`, `min`, `max`. **Write the signatures as if the element traits already existed** (so `sort` assumes "elements compare"), hard-coded for built-ins now; when the trait lands, `sort` generalizes to `T: Comparable` *without changing its shape*. This is buildable today and is exactly what early lessons need.

    **Accessor rule — crash on a broken assumption, Optional on a normal absence.** `first()` / `last()` return `T?` (`None` on empty), because an empty list is a *normal value*, not a bug — they are the guarded `.at`-family (`first()` is `at(0)` by another name). The crashing "I've proven it's there" accessor is the existing `xs[i]` — so both situations already have spellings: `xs[0]` (crash if empty) and `xs.first()` (`None` if empty). **Indices are non-negative positions from the front, period.** A negative index is *out of bounds*: `xs[-1]` crashes (bug tier, §9) and `xs.at(-1)` yields `None`. There is **no** Python-style "negative means from the end" — it would branch `[i]` on the runtime *sign* of a possibly-computed index, silently turning an accidentally-negative value into the last element (a silent wrong answer where Ascent wants a loud caught bug), and it is a false friend to the C-family (`arr[-1]` is absent/error there) that students graduate to. End-relative access is the named `last()` / `first()` — exactly what `[-1]` was reaching for, done safely (Optional, arithmetic-proof). (String `first()` / `last()` follow the same rule — `String?`, `None` on empty, §4 — and strings have no indexing at all, so the negative-index question never arises there.)
  - **Phase 2 (with §16 traits): extract the hierarchy from concrete `List` / `Map` / `Set`.** Once traits exist and there are three real collections to compare, the shared capabilities are *extracted* from evidence, not guessed. The **target** — deliberately minimal, Rust-small not Scala-sprawling, two short ladders — is: **element traits** `Equatable` → `Comparable` → `Hashable` (the ones operations *require*: `contains` needs `Equatable`, `sort`/`min`/`max` need `Comparable`, hash-based `Map`/`Set` need `Hashable`), plus **`Display`** (has a canonical string form — *discovered from evidence* in string interpolation, §4, which needs it to fill a `${}` hole; hard-coded to scalars until traits exist); and **container traits** `Iterable` (the root — yield elements one at a time, the `for` desugar target) → `Collection` (Iterable + known length / `isEmpty`; a lazy infinite stream is `Iterable` but *not* `Collection`) → `Indexed` (Collection + positional `[i]` — `List`, but not `Set`/`Map`) and `Keyed` (Map-like key → value). This is the shape to *grow toward*, **not** to build up front — the extracted hierarchy will differ from this guess, which is precisely why it must come from three concrete implementations rather than from zero.
- **String API** — `trim`/`split`/etc., and how text meets the boundary.
- **`Map` API & literals** — literal form, lookup returning `V?`, and key constraints (needs equality/hashing — trait-gated, §16).
- **Number formatting** — how `Int`/`Float` render in `${…}` and `.toStr()`.

### Core details still thin — decide with their stage

- **Collections — model settled; a builder escape open.** Decided: structures are immutable; all collection methods **return new values** using plain base-form verbs (`sort`, `reverse`, `append`, `insert`, `remove`, `map`, `filter`) — no `-ed` participle, since with mutation gone there is no mutating twin to distinguish from (§6). Change is rebinding a `mut` slot (§3, §6). Indexing has two reading accessors (§9): `xs[i]` yields `T` and crashes out-of-bounds (bug tier), `xs.at(i)` yields `T?`. Element replacement is the update form `xs with { [i] = v }` (§6), not an assignment. Still open: the precise method set and exact names, and whether to add a single quarantined **builder** — a transient, mutable-under-the-hood collection for genuine hot loops (Clojure's transients, or an array behind `Ref`) — as an advanced, opt-in escape so rebind-only never hits a performance cliff.
- **Equality & ordering on user types.** Structural `==` is decided; *ordering* (and *hashing* for `Map` keys) need `Comparable`/`Hashable` traits (§16).

### The generics / traits slot

- **The single most important forward-compat decision** — user-definable generics *and* trait-style contracts, designed so they drop in without breaking changes. Concrete design already in **§16**; it gates the trait-dependent items above (ordering, hashing, auto error-conversion, the construction-site interaction).

### Deferred by design — parked, correctly late

- **`Ref` surface** — `get`/`set` vs a `.value` field; identity vs structural equality once `Ref` exists. For cyclic data.
- **Construction-site type inference** — an expected type supplies the constructor name (`fix f = fn() -> Person => Person{ name: "A", age: 1 }`); downward propagation through the bidirectional checker (§7), nominal, *no* anonymous records; interacts with the generics slot.
- **Automatic error conversion (candidate, not committed)** — `From`-style hidden adaptation for bare `try`, weighed against honesty; revisit only if `try … else` proves noisy in real code (§9).
- **Supervised crash-recovery boundary** — isolate and restart/report a task that hits a bug, without making crashes catchable inline; preserves the two-tier model (§9).
- **`args` empty field** — does an empty text field mean `None` or `""` (§11)?

---

## 16. Forward design: traits & generics (v2)

Traits are **not in v1** — beginners use concrete types and the curated methods of §6 and never meet one. This records the *decided shape* of the v2 feature so it is not re-derived, and so v1 avoids blocking it. A trait is a **named capability** — a set of method signatures a type can claim — letting functions work over "any type that can do X." It is polymorphism **without** inheritance or subtyping: a type *claims* capabilities (a flat set), it does not *descend* from them, so §7's no-subtyping rule is undisturbed.

**Declaration** reuses the `methods` member syntax (§6) with bodies optional — a member with no body is *required*, a member with a body is a *default* the implementer inherits or overrides. `Self` denotes the implementing type.

```ascent
trait Equatable {
    equals:    fn(self, other: Self) -> Bool,                            # required
    notEquals: fn(self, other: Self) -> Bool => not self.equals(other),  # default
}
```

**Implementation** is a *separate* block — deliberately unlike a type's own `methods {}`, because an impl attaches behavior a type *claims* (and, later, may attach to a type you don't own). Keeping them apart makes "intrinsic behavior" and "a claimed capability" read as different things. The impl repeats the full signature (every signature is explicit, §7):

```ascent
implement Equatable for Player {
    equals: fn(self, other: Self) -> Bool => self.name == other.name,
}
```

**Supertraits** — traits extending traits — express **capability dependency**, written `requires`:

```ascent
trait Comparable requires Equatable {
    lessThan: fn(self, other: Self) -> Bool,
}
```

Any type implementing `Comparable` must also implement `Equatable`, and `Comparable`'s defaults may call `Equatable`'s methods. This is **not** subtyping: a `Comparable` value is not a kind-of `Equatable`, there is no hierarchy to search and no substitutability — just "implementers carry both capabilities." The keyword is `requires`, not Rust's `:`, precisely because `:` reads as "is a kind of" (the subtyping model Ascent bans); `requires` says the honest thing.

**Consumption — bounded generics.** A function generic over any type with a capability:

```ascent
fn announce<T: Equatable>(a: T, b: T) -> String =>
    if (a.equals(b)) { "same" } else { "different" }
```

`<T: Equatable>` reads "for any `T` that implements `Equatable`," and inside, the trait *guarantees* `.equals` exists. This is the consumption side of the generics slot — and the hardest part for a learner (the `<…>` / `:` bound syntax), which is why traits stay an advanced, library-author feature.

**What it unlocks** (each parked elsewhere, all the same door): extensible collections without ambient monkey-patching — a user *implements a trait* rather than bolting a method onto your `List`, gated by an **orphan rule** (an impl is allowed only if you own the trait *or* the type, which prevents collisions and spooky-action); automatic error conversion (the §15 candidate, i.e. `implement From<ReadError> for AppError`); and the hidden "value-or-not" abstraction behind `try` (§9), which stays hidden — recognizing it *as* a trait is exactly what confirms you have chosen not to surface it.

**v1's only obligation: don't block this.** Keep intrinsic behavior in the type's `methods {}` (so the later `implement` block reads as distinct); keep generics *consumable, not definable* (§7), since a user-defined generic is only useful with a bound and a bound *is* a trait — so generics and traits arrive together; and `trait`, `implement`, `requires`, and `Self` are reserved now (§2) so no future program breaks when the feature lands, even though they are unusable until then. Designed as one feature, this is the generics / traits slot of §15.

**Full open-questions inventory:** the trait system is a large, deferred design with retrofit-expensive hard parts (the orphan rule, static-vs-dynamic dispatch, associated types). Every concern — tiered by dependency, with the entry point and the *grow-don't-design* prerequisite (build concrete `List`/`Map`/`Set` first, extract the hierarchy from them) — is collected in the companion document **`traits-open-questions.md`**, to be picked up cold when the concrete collections are in hand.

---
