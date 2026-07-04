# Traits & Generics — Open Design Questions (§16)

**Status:** deferred. This is a planning/parking document, not a spec. It collects everything
that must be settled before the trait system is designed, so the work can be picked up cold later.

**Governing principle (decided):** *grow, don't design up front.* The trait system's primary client
is the collection hierarchy (`Comparable`, `Equatable`, `Iterable`, …), and we decided those traits
must be **extracted from three concrete collections** (`List`/`Map`/`Set`), not guessed from zero.
So the trait *hierarchy* (which traits exist) waits on concrete collections. The trait *engine*
(mechanism + hard semantics below) can be thought through earlier, but is parked for now by choice.

**Prerequisite before serious trait work:** build concrete `List`, then `Map`, then `Set`
(hard-coded for built-in element types, no traits). Only then is trait design grounded in evidence.

**Reserved already (§2):** `trait`, `implement`, `requires`, `Self` — usable-nowhere until this lands,
so no program breaks when it does.

---

## Tier 0 — The philosophical fork (gates everything; decide FIRST)

- **What *is* a trait in Ascent?** Three framings, pick the primary one:
  - a **capability contract** ("this type can be compared / iterated / hashed") — Rust/Swift, tied to generic bounds;
  - an **interface for dynamic dispatch** ("call a shared API polymorphically") — Java/OOP;
  - a **mathematical structure** (Monoid/Functor) — Haskell.
  - *Lean:* capability contract, primarily for generic bounds. But confirm deliberately.
- **Static vs. dynamic dispatch — the single biggest fork.** When a trait method is called, is it
  resolved at compile time (monomorphized, fast, no runtime trait objects) or at runtime
  (dynamic dispatch, trait objects, `dyn`-style, heap)?
  - Determines whether traits are *only* a compile-time bounds mechanism or *also* runtime polymorphism
    (e.g. can you hold a `List` of mixed types behind a `Drawable` trait?).
  - *Lean:* **static-only to start** (bounds, monomorphized), dynamic dispatch a separate, explicit,
    much later feature — fits value-semantics and teaching simplicity. Confirm.

## Tier 1 — Coherence (the hard heart; retrofit-expensive; decide early, together)

- **Orphan rule.** Can you `implement TraitYouDontOwn for TypeYouDontOwn`? If unrestricted, two
  libraries can define *conflicting* implementations and program meaning depends on link order.
  - Rust's answer: you must own the trait *or* the type. *This is THE hard one* — it shapes the whole
    extensibility story and is very hard to retrofit. Likely adopt a Rust-style orphan rule.
- **Overlapping implementations.** Allow both `implement Show for List<T>` and a more-specific
  `implement Show for List<Int>`? Overlap resolution is a notorious complexity sink (Haskell's
  `OverlappingInstances` regretted; Rust specialization still unstable after years).
  - *Lean for a teaching language:* **no overlap allowed, period.** Decide deliberately.

## Tier 2 — Critical path for the collection hierarchy

- **Associated types vs. type parameters.** Does a trait carry an associated type
  (`Iterable` needs an element type `Item`)? Rust's associated types are elegant but a real new concept.
  The element type has to live *somewhere* — likely needed, adds surface. **On the critical path**:
  you can't even *express* `Iterable` without deciding this.
- **Blanket / generic implementations.** `implement<T> Trait for List<T>` ("all lists are iterable").
  Needed, but interacts with the orphan rule and overlap — settle after Tier 1.

## Tier 3 — Mechanics (mostly sketched in §16; fall out once Tiers 0–2 are set)

- **Declaration.** A trait = a set of method signatures, with optional **default bodies**; `Self` = the
  implementing type. (Sketched.)
- **Implementation block.** `implement Trait for Type { ... }` as a separate block. Sub-questions:
  does it repeat full signatures? Where may it live (with the type / with the trait / anywhere,
  modulo the orphan rule)?
- **Bounds / consumption.** `<T: Trait>` on generic functions; how trait methods are called on a
  bounded `T`. This is the "consumable, not definable" side that arrives *with* generics.
- **Supertraits.** `requires` (a trait depending on another — `Ord requires Eq`). Chosen over Rust's
  `:` for honesty (dependency, not is-a). (Sketched.)
- **Trait-method call syntax.** After `implement Comparable for Foo`, does `foo.compare(bar)` work
  (method syntax), or `compare(foo, bar)` (free function), or both? Must reconcile with the §6 dot rule
  ("the dot resolves one static target on the concrete type") — trait methods are resolved on the type too,
  so likely fine, but confirm.
- **Default methods.** Trait provides defaults so implementers write only essentials. Low-risk convenience.

## Tier 4 — Teaching / staging (Ascent's special constraint)

- **Invisible to consumers early, definable only late.** A beginner must be able to *use* trait-bounded
  stdlib (`xs.sort()` on their list) **without knowing traits exist**. The "consumable, not definable"
  split (§7) is what makes this work: consuming a bound is transparent; *defining* traits is an advanced,
  late, power-opt-in feature. The design must preserve this — traits never in early lessons.
- **Naming / casing.** Traits are `UpperCamel` (declared names, like types): `Comparable`, `Iterable`.
  Consistent with §2. (Trivial; just confirming.)

---

## Dependency order (how to actually work it, when we return)

1. **Tier 0** (what a trait is + static/dynamic) — gates all.
2. **Tier 1** (orphan rule + overlap) — the hard coherence pair; decide together, early.
3. **Tier 2** (associated types) — needed before `Iterable` can even be written.
4. **Tier 3** (declaration, `implement`, bounds, `requires`, defaults, call syntax) — falls out.
5. **Tier 4** (staging) — mostly curriculum, but keep "invisible to consumers" as a hard constraint throughout.

**Entry point when we resume:** start at Tier 0 (static-vs-dynamic dispatch), then Tier 1 (orphan rule).
Those two are the retrofit-expensive, everything-hangs-off-them decisions; the rest is largely the
existing §16 sketch with details filled in — *and* it should be done with concrete `List`/`Map`/`Set`
already in hand, so the extracted hierarchy (`Equatable → Comparable → Hashable`;
`Iterable → Collection → Indexed`/`Keyed`, see §15) is grounded in evidence rather than guessed.
