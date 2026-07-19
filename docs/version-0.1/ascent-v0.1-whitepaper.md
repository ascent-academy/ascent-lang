# Ascent — Core v0.1 Whitepaper

### The implemented language, with the reasoning behind it

> *Ascent is a small, opinionated programming language for learning to program —
> designed to get beginners moving quickly and carry them smoothly up into
> mainstream languages, with honest, see-everything mechanics and no hidden magic
> along the way.*

---

> **What this document is.** This is the **v0.1 language reference**: it describes
> *only what the implementation actually does today* (checked against the source and
> the passing test suite, package version `0.18.0`, 705 tests green), and pairs each
> feature with the *why* drawn from the full design whitepaper (`ascent-whitepaper.md`,
> the settled v1 vision). Where the full whitepaper describes a feature that has **not
> yet shipped**, this document says so in a **“Not in v0.1”** note rather than pretending
> it exists. The layer split and shipping boundary are argued in `core-v0.1.md`; the
> design principles in `principles.md`; forward design in `ascent-frontiers.md`.
>
> Section numbers (§1–§13) match the full whitepaper so the two read side by side.
> Error codes (`L####`/`S####`/`N####`/`T####`/`R####`) reference the live registry in
> `src/errors/*.yml`.

---

## 1. Design principles

Every decision in Ascent answers to these seven rules.

1. **Honesty over magic.** No truthiness, no silent failure states, no two-kinds-of-nothing, no behaviour hidden in lossy conversions. The one numeric coercion — an `Int` widening to `Float` — preserves the value exactly and is visible in the result type. If something happens, it is visible.
2. **Cage the footguns at the source.** Every value is a real value with no weird states (no `NaN`, no silent overflow, no wild `null`). The dangerous thing is made *impossible* or made *explicit* — not merely documented. A footnote in a manual nobody reads is not a safety feature.
3. **Regular syntax; one meaning per surface.** The user never faces a *choice* between two independent constructs that do the same job (the `&&`-vs-`and`, `let`-vs-`const` decision tax). A transparent **abbreviation** that desugars to one underlying thing is not a choice, it is ergonomics — so `T?` (for `Optional<T>`), `T orfail E` (for `Result<T, E>`), `${}` interpolation, and `else if` are all allowed. The test: *is one form defined as the other?*
4. **Transfer to many languages, not one.** Surface syntax builds muscle memory; clean semantics build correct mental models; where they conflict, semantics win. The divergences worth eliminating are *false friends* — the same surface meaning something different elsewhere, failing *silently* (the `5 // 2` trap). What Ascent merely *has* that a target *lacks* is cheap: it becomes a compile error there, not a silent bug, so the learner is told and adapts. Every remaining divergence is a deliberate graduation lesson.
5. **Static types, low ceremony.** Types catch mistakes early; inference removes the paperwork.
6. **Errors are the product.** Compiler and runtime messages are written as explanations that name the things the learner actually wrote.
7. **Power is opt-in and late.** Advanced capability arrives as a later chapter, not a day-one tax.

---

## 2. Lexical & syntax

The lexer is hand-written, **lossless**, and **total**: whitespace and comments are emitted as trivia tokens rather than skipped, every token carries both a decoded `value` and the exact raw `text` it spans (so concatenating all `text` reconstructs the source 1:1), and *any* input tokenizes — a bad character becomes an `ERROR` token and lexing continues.

- **Braces** delimit all blocks; **no whitespace semantics**.
- **Semicolons** terminate every statement — the simplest grammar, and the key to precise parser error recovery.
- **Comments:** `#` runs to end of line; `#[ … ]#` is a delimited block comment that may sit mid-line, span lines, and **nests** (`L0008` on an unterminated one). **`//` is deliberately unused** — it means *comment* in the C family but *floor division* in Python, so either meaning would silently betray graduates to the other camp. Ascent's floor division is the word `div` (§5), so `//` builds no habit.
- **The `!` sigil marks an async call:** `fetchUser!(id)` prepares an inert `Task<T>` (§8); a bare async call without it is a compile error. The character is borrowed provisionally; what is fixed is the *concept* — an async call carries a visible marker.
- **The backtick `` ` `` is reserved** for a future tagged-DSL family and has no other use, so it never collides with strings or calls. *(Not in v0.1: no DSL blocks — the character is reserved only.)*
- **Identifiers:** `[A-Za-z_][A-Za-z0-9_]*`. The **reserved keywords** are: `div`, `mod`, `and`, `or`, `not`, `fix`, `mut`, `if`, `else`, `while`, `for`, `in`, `program`, `type`, `void`, `match`, `fn`, `return`, `abort`, `orfail`, `try`, `with`, `async`, `await`, `import`, `from`. `True`, `False`, `None`, `Done` are **not** keywords — they are **non-shadowable built-in constructors** (you can no more rebind `True` than redefine `42`).
- **Naming & casing — bidirectional and enforced.** **Uppercase (`UpperCamel`) names are exactly those a `type` introduces** — the type *and* all of its constructors — with no exceptions. **Lowercase (`lowerCamel`) names are bindings** — variables, functions, fields, parameters — and a binding *may not* begin with a capital. So an initial capital *always* means “type or constructor” and an initial lowercase *always* means “binding”, with no ambiguity ever (Haskell's discipline). Position disambiguates the harmless type/constructor overlap (`Color`/`Red`): a type appears only after `:` or `->`, a constructor only in value/pattern position. *Graduation note:* capitalized `True`/`False`/`None` match Python but diverge from the C family — a named, deliberate false friend, accepted because internal consistency wins (`Bool` and `Optional` are ordinary tagged unions, so their constructors are uppercase like every other).
- **Type names use the dominant canonical spelling, not the shortest:** `Int` (over `Integer`), `Float`, `Bool` (over `Boolean`), `String` (over `Str`). `Str` is rejected because `str` denotes a *different, advanced* thing in Rust — a false friend, not a tidy abbreviation.
- **Mandatory braces** on every `if` / `for` / `while`, even single-line (no dangling-else, no goto-fail class of bug). The **test** of `if` / `while` / `match` is **parenthesized** — `if (cond) { … }` — easing the move to TypeScript and the C family; `for` takes no parens (it has no test).
- **Expression-oriented: every block yields the value of its last statement** — a branch, a loop body, a function body, and the whole program alike (one rule, no special cases). The trailing `;` is optional exactly as a list's trailing comma is — never load-bearing for the value. A last statement that is not a value (a declaration, an assignment) yields `Done`.
- **Discarding a value is explicit — `void` — and the rule is about *position*.** The unifying principle: **a value must go somewhere — consumed, or explicitly discarded, never silently dropped.** Some positions are **`Done`-required**, because nothing consumes the block's value:
  - **A non-final statement** of a block — another statement follows (`T0057`). In `foo(); bar()`, if `foo()` returns non-`Done` you write `void foo();`.
  - **A loop body** (`for`/`while`) — the loop as a whole yields `Done`, so it ignores whatever its body yields (`T0058`). `for x in xs { x + 1 }` is an error; write `void x + 1`, or — if you meant to *collect* — that is what a mapping operation is for. The error doubles as the lesson that a `for` loop does not build a value.

  Everything else is a **value position** and is unconstrained. Nothing needs `void` where there is nothing to drop (a `Done`-valued call, a bound value, a value used in an expression). `void` on an already-`Done` value is itself the error `T0059`. There is **no `void` type** — a function that “returns nothing” returns `Done` (§4).

---

## 3. Slots

A **slot** is a named, value-holding location — *variable* in the colloquial sense. The mental model is **name → slot → value**. A slot is a *container, not a reference*: assignment copies (value semantics, §4), so writing through one slot can never reach another.

```ascent
fix name = "Ada";    # a fixed slot — the name cannot be reassigned
mut count = 0;       # a mutable slot
count = count + 1;   # fine; would be N0002 on a fixed slot
```

- **`fix` / `mut` are stated on every slot — there is no default** (unlike Rust/Swift's immutable-default or C/Java's mutable-default). Nothing about a declaration depends on a rule you must recall; each line is legible alone, and every declaration forces the “does this change?” question. It costs less here than elsewhere: the usual reason to *default* to immutable is to prevent aliasing surprises, and value semantics has already removed those.
- **The slot is the only mutable thing in the language.** No *value* ever changes in place — not a list, not a record, nothing. “Mutating” a structure means computing a new value and rebinding a `mut` slot (`xs = xs.append(4)`). One uniform story: immutable values everywhere, change confined to the single visible act of rebinding a `mut` slot.
- **`fix` constrains the slot** (rebinding the name), not the deep mutability of the value.
- **A `fix` binding is in scope within its own initializer** — so a recursive function `fix f = fn(n: Int): Int => … f(n - 1) …` works (the closure captures the *slot* `f`, filled by call time). *Eager* self-reference (`fix x = x + 1`, the value read before it exists) is a caught “used before initialized” error (`N0001`).
- **Graduation:** this is `let` / `let mut` in Rust, `val` / `var` in Swift/Kotlin, `const` / `let` in JavaScript — where `let` flips between *immutable* (Rust) and *mutable* (JS), a clash `fix`/`mut` sidesteps by belonging to no one.

> **Not in v0.1:** `Ref<T>` (the explicit shared-mutable/cyclic escape hatch) and **mutual recursion** (which will arrive as an explicit `rec { … }` grouping form, never by silently hoisting lambda bindings).

---

## 4. Values & types (the value universe)

The type lattice (`src/types/types.ts`) is: `Int`, `Float`, `Bool`, `String`, `None`, `Done`, `Never`, `Invalid`, `List<T>`, `Optional<T>` (`T?`), `Result<T, E>` (`T orfail E`), `Range`, `Task<T>`, function types, and user `Named` types. `Never` and `Invalid` are checker-internal (§7).

### Scalars

- **`Int`** — 64-bit signed, written `42`. **Traps on overflow** with a friendly message (`R0001`) — no silent wraparound. Promotes one-way to `Float` in mixed arithmetic (§5). No width/unsigned zoo.
- **`Float`** — 64-bit IEEE 754, written `3.14`; a digit is **required on both sides** of the point (no `3.` or `.5` — `L0003`). **`NaN` / `Infinity` are runtime errors** (`R0004`), not values, so every `Float` is a real, ordered number.
- **`Bool`** — `True` / `False`. **No truthiness** — a condition must be `Bool` (`T0009`).
- **`String`** — immutable Unicode sequence, double-quoted, with `${expr}` interpolation. A plain `"…"` is **strictly single-line** (`L0004` on a missing close), so the commonest typo is caught at end of line rather than swallowing the rest of the file. **No integer indexing** (below); no `Char` type — a character is a length-1 string.
- **No integer indexing on strings — the Rust/Swift way, with named methods that don't lie.** `s[i]` does not exist, because “the *i*-th character” has no honest answer over Unicode: a byte gives you half of `é`, a code unit gives you half an emoji, and even a code point is not a grapheme; worse, under UTF-8 `[i]` would *look* like O(1) random access while secretly being O(i). This bites hardest on non-English text and on beginners — `name[0]` is intuitive and *wrong* on `"Dvořák"`. So the honest operations are **named and explicit about their unit**: `s.chars()`, `s.first()` / `s.last()` (returning `String?`), `s.slice(range)`. This gives “first character”, “loop the characters”, and “substring” with none of the half-a-character trap.

### Strings — building and interpolation

- **Multiline strings use `"""…"""`.** The **closing `"""`'s column sets the margin**, and that much leading whitespace is stripped from every line (Swift's rule, `L0006` when a line is under-indented); a newline immediately after the opening `"""` is dropped. `${}` interpolation is always-on here too — one uniform string model.

  ```ascent
  fix poem = """
      Roses are ${color},
      Ascent is small.
      """      # → "Roses are red,\nAscent is small."
  ```
- **What can go in a `${}` hole — a `Display`-bounded position.** Interpolation must turn the hole's value into a `String`, so the hole requires a value with a canonical string form. The **built-in scalars have one** (`Int` → decimal digits, `Float` → digits *with the point always shown* — `3.0`, never `3` — `Bool` → `"True"`/`"False"`, `String` → itself). **Structured types have no canonical string form**, so `"${user}"` is a compile error (`T0018`) directing you to a scalar field (`"${user.name}"`) or an explicit conversion (`"${money.toString()}"`). There is deliberately **no universal `toString`** on every type — that would be an `Any`-supertype by another name, producing dishonest field-dump output. Formally the hole is a `T: Display` position; **today `Display` is hard-coded to the scalars** (🔒 — see §7's intrinsic traits), and generalises to a real trait later with no change to any existing program.
- **No arithmetic operator works on strings.** `+` stays purely numeric — overloading it for concatenation is the doorway to JavaScript's `1 + "2"` → `"12"` disaster, and `"hi" * 5` is a *pun*, not a meaning. **Building** a string is `${}` interpolation or a named method; **repetition/padding/trimming** are self-naming methods (`.repeat(5)`, `.padLeft(n)`, `.trim()`), each reading as what it does. Extra interpolation content in one hole (`"${a b}"`) is `S0014`.

### The “no information” value

- **`Done`** — the unit type, the value of statements and side-effecting calls (`print : Fn(String) -> Done`). It has exactly one value, written `{}` (an empty block). There is **no `done` keyword**, so `done` stays free as a name.

### Absence

- **`None`** — the one absent value. **`T?` is sugar for `Optional<T>`** — an ordinary “`None` or a value”, not a special form. A bare `String` can never be `None`. There is no `undefined`, no second kind of nothing, and — crucially — **no `Some(...)` wrapper**: presence is just the bare value.

  ```ascent
  fix nick: String? = None;
  fix shown = nick ?? "anonymous";
  ```

- The recovery tools live in §9 (`??` to default — Optional-only; `try` to propagate; `match` to inspect). A lone `None` with no annotation and no context is `T0002` (its type must be written down).

### Compound

- **`List<T>`** — homogeneous: one element type `T`. A literal `[1, 2, 3]` infers `T` as the **least common type of its elements**: all `Int` → `List<Int>`; an `Int`/`Float` mix → `List<Float>` (the `Int`s promote, the same one-way rule as §5); elements with no common type (`[1, "x", True]`) are `T0005`. The empty `[]` is typed **`List<Never>`** as an expression and flows into any expected-type position (`fix xs: List<Int> = []`, a `List<T>` parameter); but a bare unannotated `fix xs = []` is `T0003` (annotate it) — resolution comes only from expected-type context, never from a later use. Growth is gated by a `mut` slot.
- **`Range`** — `a..b`, **half-open** (`0..n` yields exactly `n` items), iterable by `for` (§5), pairs cleanly with lengths, replaces the C-style `for`. Bounds must be `Int` (`T0020`).
- **Functions** — first-class values (§5).

> **Not in v0.1:** `Map<K,V>`, `Set`, `Bytes`, `Char`, tuples (use a named record), sized/unsigned ints, `Ref<T>`, and the compile-time-validated DSL literals (`json`…`` etc.). Value semantics *is* shipped: assignment is conceptually a copy, no aliasing.

---

## 5. Expressions & control flow

- **`if (cond) { } else if (cond) { } else { }`** are **expressions** — there is no separate ternary, and `else if` is the only control-flow sugar. Both branches of a value-position `if` must agree in type (`T0010`).
- **`match subject { }`** — an expression, **exhaustiveness-checked**. Patterns are **shallow**, in three kinds: **literal** (`0`, `"hi"`, `True`), **variant** (`Circle{ r }` — matches a union case and binds a chosen subset of its fields), and **catch-all**. Catch-all has two spellings that are the same mechanism (“the rest”): **`else`** binds nothing (`else -> "many"`), and a **bare identifier** binds the matched value (`value -> "hello ${value}"`) — this is how an `Optional`'s present case is destructured, since there is no `Some` wrapper to name. At most one catch-all, and it must be last; a catch-all after full variant coverage is an unreachable-arm error (`T0033`), so a fully-listed `match` re-triggers exhaustiveness (`T0031`) when you add a variant later — future-variant safety, automatic. Non-exhaustive scalar/optional matches are `T0030`/`T0046`.

  ```ascent
  match name {
      None  -> "no name given",
      value -> "hello, ${value}",   # `value` is the present String (narrowed, §7)
  }
  ```

- **`while (cond) { }`** for condition loops. **`for x in xs`** iterates values and takes **no parens** — parenthesizing it would mimic TypeScript's *key*-iterating `for…in`, the false friend the choice avoids. There is **no C-style three-part `for`**. Both loops are statements that **yield `Done`**; producing a value *from* a sequence is a collection operation's job, not loop-return — which keeps the block-value rule special-case-free (a loop body is a `Done`-required position, §2). The iterable must be a `List` or a `Range` (`T0021`) — see the `Iterable` weld in §7.
- **Operators are words:** `and` / `or` / `not`, on `Bool` only.
- **`==`** is **structural**; operands must share a type, except that `Int` and `Float` compare as numbers (`1 == 1.0` is `True`). Other cross-type comparison is `T0008`. **`< > <= >=`** work on `Int` / `Float` / `String`, with the same `Int`/`Float` mixing.
- **Numbers promote one way — `Int` → `Float`, never back.** `+`, `-`, `*` yield an `Int` only when *every* operand is an `Int`, and a `Float` the moment any operand is one. A `Float` is never silently narrowed — that needs an explicit `.toInt()`.
- **Division & modulo.** `/` **always yields a `Float`** (`10 / 2` is `5.0`, `7 / 2` is `3.5`), so the silent integer-truncation bug cannot occur. **`div`** is floor division on `Int` operands only; **`mod`** is its floored partner (result takes the **sign of the divisor** — `-7 mod 3` is `2`), so `(a div b) * b + (a mod b) == a` always holds. Using either on a `Float` is a type error; division by zero is the loud crash `R0002`. Both are words, not `//` / `%` (which are false friends, §2).
- **Exponentiation `**`** follows the promotion of `*`, not the always-`Float` of `/`: **`Int ** Int` is an `Int`** (`2 ** 10` is `1024`, exact), and a `Float` operand makes it `Float`. A **negative integer exponent** (`2 ** -1`) is a loud crash (`R0003`) whose message says to use a `Float` base — the operation stays exact-or-errors rather than truncating to `0`. Right-associative, and binds tighter than unary minus (`-2 ** 2` is `-4`).
- **`??`** is Optional-coalescing (`opt ?? fallback`), **right-associative**, and **allowed on `Optional` only** — a `Result`'s error must be acknowledged, not silently defaulted (`T0044`; a mistyped default is `T0045`).
- **Operator precedence**, loosest → tightest: `or` · `and` · `not` · comparisons (non-associative — no chaining, `S0005`) · `??` · `+ -` · `* / div mod` · unary `-` · `**` · atoms. The expression parser is Pratt-style.

### Functions

- **Every body starts with `=>`, then either a `{ }` block or a single expression.** A block body's value is its last statement (§2), so no `return` is needed; the lighter `=> expr` form drops the braces for a single expression. A body with no arrow at all is `S0026`.

  ```ascent
  fix inc    = fn(x: Int): Int => x + 1;
  fix double = fn(x: Int): Int => { fix y = x + 1; y * 2 };
  ```

- **Return type sits after a colon** (`: Int`), matching the ordinary annotation colon. A **function *type*** is written with an arrow and capitalized `Fn`: `Fn(Int) -> String` — the split (declaration colon, function-type arrow) is exactly TypeScript's, and keeps higher-order signatures legible when they nest (`map(f: Fn(T) -> U): List<U>`).
- **Closures capture by value** — a closure *snapshots* the values of the outer names it uses at creation time, so the famous loop-capture footgun cannot occur. This is value semantics (§3) extended to closures: one rule everywhere.
- **`return`** is **early-exit only** — reaching the end is the normal path, and the body's value is its last statement. `return` outside a function is `T0043`.
- **Type grammar:** parentheses group; the postfix **`?`** binds tighter than `orfail` and than an `Fn` arrow; **`?` is idempotent** (`T?? ≡ T?`, since one global `None` and no `Some` wrapper mean both have the same inhabitants) — writing `String??` explicitly earns a redundancy warning (`T0047`). **`orfail` does *not* collapse** — `Success`/`Failure` are real wrappers, so `(T orfail E)?` is a genuine three-way.

> **Not in v0.1:** there is no `fn name(...)` declaration form — a function is *only* `fix f = fn(...)`. Mutual recursion is deferred (§3).

---

## 6. Data model

**One** user-defined construct: the tagged union, introduced with **`type`**. It subsumes records, enums, and unions.

```ascent
type User  = { name: String, age: Int };               # record (single variant)
type Color = Red | Green | Blue;                        # enum (zero-field variants)
type Shape =                                            # union (multi-variant)
    | Circle{ radius: Float }
    | Rect{ width: Float, height: Float };
```

- **The single-variant / record form — and why you don't write the name twice.** A one-variant type is a **record**: a fixed set of named, typed **fields**. Its full form names the sole constructor (`type User = User{ … }`), but the **`type X = { fields }`** sugar auto-names the constructor after the type, so you never repeat `User`. A multi-variant type never elides — its variants have distinct names. Terminology: a single-variant type is a *record* (not an “object”, which would wrongly import identity/mutation/attached methods; not a “struct”, a layout term) — “record” transfers to Elm / F# / Haskell.
- **Bare `{ … }` is legal *only* at the type-declaration head.** Everywhere else — a field's type, a parameter, a return type — you name the type (`fn(p: User)`, never `fn(p: { name: String })`). The sugar supplies a *constructor* name; it never introduces a floating structural type (that would be the structural typing §7 shuts out).
- **Field-access rule:** `e.field` is legal **iff `e`'s type has exactly one variant** (a record, `T0026`/`T0027`). A **multi-variant** value exposes no direct fields — it must be inspected with `match` (`T0028`, whose message teaches sum types).
- **Construction requires a declared type.** Values are built as `TypeName{ field: value, … }`; there are no anonymous record literals, and a `type` is never created implicitly — so a misspelled type or field is a caught error (`N0005`, `T0023`), not a silently-new type. Missing/duplicate/wrong-typed fields are `T0022`/`T0024`/`T0025`. A multi-variant type is built by a *variant* name, not the type name (`N0011`).
- **Why lists infer their type but records don't.** A list has one degree of freedom (its element type); a record literal would have to invent a whole *shape* — conjuring a new type from a value, i.e. structural typing, which reopens what construction closed (`{ nmae: "Martin" }` would be a valid value of a *different* inferred type rather than a caught typo). So: **containers infer their contents; concepts get named.**
- **Unions are named and tagged — no anonymous `Int | String`.** An anonymous untagged union would force runtime type interrogation, structural typing, and a flow-narrowing sublanguage — all of which the nominal system excludes. A tagged value *announces* its case, so you `match` the tag it already carries.
- **Irrefutable destructuring in a binding — the honest replacement for tuples.** A `fix`/`mut` binding may hold a *pattern* when that pattern is **irrefutable** (a single-variant record), binding its fields **by name** in one statement:

  ```ascent
  fix User{ name, age } = loadUser();   # name and age now in scope, bound by field name
  ```

  This is the good half of tuples without the bad: fields bind by name, not by position, so a swap is impossible. A **refutable** pattern — a union variant that might not match — is `T0034`; it requires `match`, so the other cases are handled.
- **Update with `with`.** A new value derived from an existing one, with some positions replaced: `base with path = value` (braceless for one change) or `base with { p1 = v1, p2 = v2 }` (braces for several). A **path** is exactly the *access* expression you would write to read that position, minus its root — freely mixing `.field` and `[index]` steps:

  ```ascent
  user  with name = "new"                        # single field
  xs    with [3] = 42                            # single index
  grid  with [2][5] = 99                         # 2-D index
  model with users[3].address.city = "Prague"    # deep path
  model with count = its.count + 1               # `its` is the base value
  order with { total = its.total * 1.2, paid = True }
  ```

  The update path *is* the read path — nothing new to learn. `=` (not `:`) marks it as assign-into-a-copy rather than construction, and matches the assignment every mainstream language writes. **`its`** is the base value, navigated like a read. **Paths navigate existing structure and never create it** — records can't grow, and an out-of-range index anywhere along a path crashes (`R0005`), consistent with reading `xs[i]`. Update errors are framed and beginner-instructive at any depth (`T0035`–`T0041`).
- **No classes, inheritance, or subtyping — ever** (they would require subtyping, which §7 forecloses). Data is pure data.

> **Not in v0.1 — user types are *pure data*.** There is **no user `methods { }` clause**: behaviour on your own types lives in **free functions** (`area(shape)`, not `shape.area()`), which the language already supports (§5). This is deferred to v2, when it arrives alongside traits. Also deferred: **`make { }`** guarded construction and **`opaque type`** representation-hiding. (Built-in types *do* ship their own methods — §10.)

---

## 7. Type system

The checker mainly answers one question — *“are these two named types the same?”*

- **Nominal typing.** A `User` is a `User` because it was declared one.
- **No subtype hierarchy — a narrow, fixed widening relation instead.** There is no inheritance and no variance system; `subtype()` in `src/types/types.ts` is a small, closed set of value-preserving rules, each returning a runtime coercion witness: **`Int <: Float`** (the one numeric widening), **covariant `List`** and **covariant `Result`** (sound because values are immutable — the covariance-is-unsound trap needs mutation, which does not exist here), **`Optional` widening** (a bare `T` or `None` is usable where `T?` is expected — never wrapped, since there is no `Some`), and **`Never <: T`** for every `T`. `x.f()` is a nominal lookup of `f` on `x`'s concrete type — at most one match, no overloading, no dispatch hierarchy.
- **`Never`, the bottom type — machinery, not vocabulary.** A few expressions *diverge* — `abort` (§9), `.orAbort()`'s failing case, a bug-tier crash, a `try`'s bad-case arm, an infinite loop. Their type is `Never`, assignable to every type — which is what lets a `match` arm `abort` while the arm beside it yields an `Int`. `Never` is **not a type anyone writes** (no `-> Never`); it lives in the checker and surfaces only as plain diagnostics (e.g. `T0004`, a slot given a value that never arrives).
- **`Invalid`, the failure placeholder — the dual of `Never`.** A checker-internal tombstone a sub-expression receives when its own check *fails* (always alongside an emitted diagnostic), so checking continues and a fully-typed tree is always produced for tooling. It **absorbs in both directions** and any operation on it yields `Invalid` **with no new diagnostic** — the cascade-suppression that reports one error at `x` rather than ten across everything using `x`. It is never in a user-facing message, and **any `Invalid` in the final tree fails compilation** (checking-continues never means program-is-valid).
- **The empty collection literal is `List<Never>`.** As an *expression* `[]` is `List<Never>` — true (no elements) and useful (`Never` fits anywhere) — and because lists are immutable and thus soundly covariant, it flows into any `List<T>` expected-type position with no annotation. A bare `fix xs = []` with no context is `T0003` (`containsNever()` catches this recursively, e.g. `[[]]`); resolution comes only from expected-type context, never a later use (a slot's type is fixed at its binding). No `?`/`dynamic`/`Any` type is introduced — `Never` is the honest answer, and immutability is what makes it flow.
- **Inference lives only on slots.** Every function signature is fully explicit — **both parameter and return types are mandatory** — so nothing about a function's type is reconstructed from its body, errors stay local, and recursion needs no special case. A slot's type is inferred from its initializer. Implemented via **bidirectional type checking** (bounded, no global unification): synthesis (`Γ ⊢ e ⇒ T`) where no expectation flows in, and checking (`Γ ⊢ e ⇐ T`) where an expected type from a `fix`/`mut` annotation flows in (used to adopt an empty list's element type or widen a list literal toward it).
- **Narrowing is by *binding*, not flow-sensitive slot retyping.** A slot's type is fixed at its binding, so Ascent does **not** silently retype an existing slot mid-scope the way TypeScript does. Narrowing instead happens by introducing a *new, well-typed binding*: **`match` narrows a union to a variant** (binding its fields at their known types), and **`T?` narrows to `T`** through `match`, `??`, `try`, and `.orAbort()`. The narrowed value always has a name and a scope on the page — explicit and refactor-stable. *(A bare `if (x != None) { … }` does **not** narrow `x` in v0.1 — inside the guard `x` is still `T?`; the whitepaper's `!= None` flow-narrowing shortcut is not yet implemented, so reach for `match` or `??`.)*
- **Intrinsic traits — the compiler-known, consumed-not-defined half of the trait system** (`src/check/traits.ts`). Three built-in capabilities are named, each a fixed `satisfies` predicate over a fixed implementor set, with **no user `trait`/`implement` syntax yet** — the marked **🔒 welds** where a trait-shaped rule is hard-coded until traits land in v2:

  | Trait 🔒 | Capability | Where it is consumed | Hard-coded implementors (today) |
  |---|---|---|---|
  | `Display` | “has a canonical text form” | `${}` holes, `print`'s argument | `Int`, `Float`, `Bool`, `String` |
  | `Comparable` | “can be ordered” | stdlib `math.min`/`max` | `Int`, `Float`, `String` |
  | `Iterable` | “can be walked one element at a time” | `for x in xs` | `List<T>`, `Range` |

  `Iterable` additionally carries an **associated type** `Item` (the element `for` binds) — the projection a real trait system writes `<T as Iterable>::Item`, hard-coded here (`List<T>` → `T`, `Range` → `Int`). So v2 buys user-defined *implementors*, not the mechanism — nothing to solve now, only to label. A trait is a **bound on a type parameter, not a type**: `fn(x: Display)` (trait-as-type / a boxed dynamic dispatch) is unsupported; traits are static-only, resolved per concrete `T`.

> **Not in v0.1:** user-definable **generics and traits** (the only polymorphism today is built-in operators, the built-in generic containers `List`/`Optional`/`Result`, and the three intrinsic traits above). No type-level computation.

---

## 8. Async & concurrency

**Colored `async` / `await` — the convergent mainstream surface** shared by JS, TypeScript, Python, Rust, and Swift. An `async` function is marked at its definition, and async-ness propagates. The color is *true, transferable knowledge* — a graduate meets exactly this everywhere.

```ascent
fix fetchUser = async fn(id: Int): User => {
    fix response = await httpGet!("/users/${id}");
    parseUser(response)
};
```

- **An async function is not called — it is *prepared into a task*.** Calling a normal function runs its body; an `async` function's body suspends partway, so “call it and get the `User`” is impossible. What you get is a **`Task<User>`**: the work with its arguments bound, *not yet running*. Python hides this behind ordinary call syntax (a secret un-run coroutine); Ascent makes it **visible with the `!` sigil**:

  ```ascent
  fix userTask = fetchUser!(id);   # Task<User> — bound, body NOT run, nothing happening yet
  ```

  A **bare async call `fetchUser(id)` (no `!`) is a compile error** (`T0053`) — there is no “just call it”. Using `!` on a non-async function is `T0054`.
- **A task is an inert, first-class value** — safe to hold and pass around, because nothing is happening yet.
- **`await` takes a task and starts-and-waits** (`T0055` if given a non-task; `T0056` outside an `async` function). There is no auto-coercion and no hidden preparation — the `!` that made the task is always visible.
- **What `await` *means*.** Not “this takes a long time” — it marks where **your program is not the one doing the work** (it has delegated to the disk, the network, another machine, and is waiting, idle). You `await` what you **delegate**, never what you **compute**. This is the same boundary as a `program`'s inputs (§11) — the edge between pure computation and the uncertain outside world.
- **`await` and `try` compose orthogonally** (§9), inside-out in the real order of events: `try await readLines!(path)` — wait for the disk, *then* handle failure. `await try` is not a valid order (there is no `Result` to `try` until `await` produces one).
- The top level of a program is treated as `async`, so a first `await` works without ceremony.

> **Not in v0.1:** structured concurrency — **nurseries**, `start`, combinators (`all`/`gather`/`race`/`any`), channels, and cancellation. v0.1 async is single-task: prepare with `!`, `await` on the spot. This is the deliberate staging — concurrency appears only when “I want two slow things at once” first arises.

---

## 9. Error handling & diagnostics

- **Two tiers of failure.** A **bug** crashes loudly and uncatchably (index out of bounds, overflow, divide-by-zero) with a precise message and location — you *fix* it, you don't handle it. An **expected failure** is a **value**: its possibility sits in the return type, so it can never tunnel invisibly up the stack the way an exception can. Indexing shows both tiers on one operation: `xs[i]` returns `T` and **crashes** on a bad index (`R0005` — you asserted it was valid), while a maybe-absent lookup is modelled as `T?`.
- **Absence is `Optional<T>` (`T?`); failure-with-a-reason is `Result<T, E>`, spelled `T orfail E`** — a two-case union `Success{ value: T } | Failure{ error: E }`. Both are sugar for one underlying union. `orfail` reads “a `T`, or a failure `E`”, its `fail` threading into the `Failure` you get on the bad case — a *returned value*, never a thrown, stack-unwinding exception. A lone `Success`/`Failure` with no context is `T0048` (the whole Result type must be stated).
- **`match` is the full handler** — a `Result`/`Optional` is just a union, opened by the exhaustive `match` you already have, both cases handled, the reason in hand.
- **`try` is the propagation shorthand**, spanning `Optional` and `Result`: `try expr` unwraps the good case or **early-returns the bad case** from the enclosing function. So a function that uses `try` must itself return a compatible `Optional`/`Result` (`T0051`) — fallibility is forced into the signature and cannot hide. `try` on a non-fallible value is `T0050`. **`try … else e -> mapExpr`** maps the error before propagating — the desugared `Failure` arm made visible — adapting a foreign error into the function's declared type (for an `Optional`, whose bad case carries nothing, the binding is dropped; naming one is `T0052`). **At the top level there is no enclosing function to return to, so `try` is legal there too** (the now-`retired` `T0049` used to reject it) **and its bad case instead stops the program directly**, reported as a runtime error — a `Failure` (`R0015`) or a `None` (`R0016`) — the same shape a `.orAbort()` crash takes.
- **`??` is the gentle Optional default — Optional only** (§5). A `None` carries no information, so defaulting it discards nothing; a `Result`'s `Failure` carries a reason, and silently dropping it is the dishonesty Ascent refuses.
- **`.orAbort(message?)` reports the error and escapes.** A method on `Result`/`Optional`: it unwraps the good case, or aborts through the bug-tier crash. On a `Result` it **reports the carried `Failure`** (`R0009`) — the most informative thing available; on an `Optional`, a locator (`R0010`). The optional message *augments*, never replaces. Being a visible call, every such gamble is greppable — the “I don't want to handle this” default that still surfaces the real reason.
- **`abort "reason"` is the unreachable-branch tool, not an error tool.** A diverging expression (type `Never`, §7) for the case where there is *no* error value to report — a `match` arm or `else` you have proven impossible — so the human `reason` is the only information there is, and is required (`T0060` if it is not a `String`; `R0008` when actually hit). It composes anywhere a value is expected because it diverges, and is deliberately outside the error story (never the way to “skip” a `Result` — that is `.orAbort()`).
- **No fallibility keyword on the producer side** (no `throws fn`): failure is *data* already named in the return type — the type is the marker. **No `try`/`catch`, no exceptions, ever.** The `Optional`/`Result`/`Task` unity (a monad, and `try`/`await` both its “unwrap”) lives in the compiler and one sentence of docs, never in the surface — each box gets its own concrete keyword.

### Diagnostics: errors are the product

A diagnostic is a **lesson**, not a scolding — a structured `Diagnostic` value (pure data, no embedded formatting) rendered by editor or terminal. The pipeline is two-phase: every stage accumulates raw `Marker`s (`{ code, span, data? }`); then `elaborate(marker, source)` looks the code up in a generated table (built from `src/errors/*.yml`) and fills in the human-facing message, explanation, fix, and example.

**Style contract** — every message: (1) the compiler takes the blame, never the student (“I found…”); (2) describes, doesn't accuse; (3) proposes a concrete fix in the student's own code where the correction is unambiguous; (4) is a micro-lesson written in plain language for an absolute beginner (say `Int`/`Float`/`function`, not “token”/“literal”).

**Stable, append-only codes**, namespaced by the *nature* of the mistake (not the stage that catches it) — each has its own counter and is never renumbered, reused, or deleted (retire with `retired: true`):

- **`L` Lexical** (`L0001`–`L0008`) — the characters don't form valid Ascent.
- **`S` Syntax** (`S0001`–`S0043`) — the words are fine alone but don't fit together.
- **`N` Name & binding** (`N0001`–`N0016`) — a name/slot rule is broken.
- **`T` Type & semantic** (`T0001`–`T0062`) — well-formed code breaks a static rule.
- **`R` Runtime** (`R0001`–`R0016`) — only running reveals it; thrown as a `RuntimeError`, a distinct bug-tier crash path.

---

## 10. Modules & the standard library

Ascent's built-ins split into two layers with different lifecycles, and the code enforces the seam.

- **Layer 1 — the Language** (closed): the lexer, parser, checker rules, evaluator, *and* the built-in **vocabulary** — the types, their literal syntax, the constructors, and the operators. This is *not* a function prelude; it is the language itself, ambient like grammar. You no more import `Int` than you import `+`.
- **Layer 2 — the Standard Library** (growable): the **methods** on built-in types and the **free functions**. Members are added as catalog entries without touching the core.

**A minimal prelude — just `print` — is ambient; every other function is imported.** `print<T: Display>(value: T) -> Done` (§4, 🔒 `Display`) is the one ambient exception, because it is useful in the window after a learner wants line output but before the module system is taught. Using it as a value rather than calling it is `N0013`.

### The module system (v0.1 — stdlib import only)

`import` reaches the free-function stdlib, in the two whitepaper forms:

```ascent
import { min, max } from "math";     # named — used bare:      min(a, b)
import math from "math";             # namespace — used qualified: math.min(a, b)
```

They are distinguished by the braces (`{ … }` is named, a bare name is the namespace binding), unambiguous *precisely because there are no default exports*. Both forms resolve to **one typed `call` node carrying its `module`**, so the interpreter dispatches every stdlib call through one path. Module specifiers name entries in a **compiler-known registry** — a fixed, blessed set of names, no filesystem and no path resolution. An unknown module is `N0014`, an unknown export `N0015`, a namespace misused as a bare value `N0016`. Imports must lead the file (`S0042` inside a body, `S0043` after other code); the registry tables (`MODULE_SIGS` / `MODULE_IMPLS`) mirror the methods' two-table pattern, pinned by a parity meta-test.

**Free-function stdlib catalog (initial — growable):**

| Module | Members |
|---|---|
| `math` | `min`, `max` (🔒 `Comparable`, `T0061` on unorderable) · `sqrt` → `Float` · `floor`, `ceil`, `round` → `Int` |
| `assert` | `assert(cond: Bool) -> Done` (`R0011` on false) · `assertEqual(a, b) -> Done` (`T0062` on unrelated types, `R0012` on inequality) |

> **Not in v0.1:** user-authored modules — `export`, relative-path files (`"./x.ascent"`), the path-is-identity resolver, circular-import handling, external/bare-specifier packages, and wildcard imports (refused on principle). These all arrive later, reusing the same `import` and adding only `export` + file resolution.

### Built-in methods (ambient on their type)

Collection/string/conversion operations stay **built-in methods** (Option A — chaining survives): `xs.append(y)`, `s.trim()`, `n.toString()`. The method half is a `METHODS` signature table (`src/check/signatures.ts`) mirrored by `METHOD_IMPLS`, kept in sync by a parity meta-test — growing the catalog is a table entry, not new control flow.

| Receiver | Methods (implemented today) |
|---|---|
| `Int` | `toString → String` · `toFloat → Float` · `abs → Int` |
| `Float` | `toString → String` · `toInt → Int` · `abs → Float` |
| `String` | `length → Int` · `first`/`last → String?` · `chars → List<String>` · `slice(Range) → String` (`R0006` on a bad bound) · `repeat(Int) → String` (`R0007` on negative) · `trim → String` · `padLeft(Int) → String` |
| `List<T>` | `length → Int` · `isEmpty → Bool` · `reverse → List<T>` · `append(T)`/`prepend(T) → List<T>` (widening to the join) · `concat(List<T>) → List<T>` |
| `Range` | `length → Int` · `toList → List<Int>` · `contains(Int) → Bool` |
| `Optional` / `Result` | `.orAbort(msg?)` → the unwrapped good type (§9) |

**Method dispatch.** `x.f()` resolves to exactly one target — a method on `x`'s concrete type, or an error — with no hidden free-function call, no overloading, no inheritance chain. Real chaining (`xs.reverse().concat(ys)`) is genuine, not sugar; no pipe operator is needed. Indexing (`xs[i]`) is language syntax, not a method — it returns `T` and crashes out of bounds (`R0005`), while the maybe-absent form is `T?`. `T0011` fires when a type has no methods at all, `T0012` when it has methods but not this one.

> **Near-term catalog growth (not yet shipped):** `List.map`/`filter`/`reduce`/`find`/`at`/`contains`, `sort`/`min`/`max` (🔒 `Comparable`), and the `toString` → `toStr` rename are the next planned additions — pure table growth, no language change. They are documented here as *planned*, not as present.

---

## 11. The entry point — `program`

The simplest Ascent program is just a sequence of statements; the block-value rule (§2) makes its last value the output, so the first program is literally:

```ascent
"Hello, world!"
```

When a program needs **named inputs**, it wraps its executable part in an explicit **`program (params) { body }`** — the entry point spelled as a function:

```ascent
program (age: Int, name: String) {
    "Hi ${name} — next year you'll be ${age + 1}"
}
```

- **`program` *is* `main`, made literal.** A file is top-level declarations (types and `fix name = fn(…)` helpers), then the program's executable part. Helpers and types sit **above** `program` (the natural order); everything inside `program { … }` runs, everything outside it defines.
- **`program` is optional, and appears only when there are inputs.** With no named inputs you write **a bare statement sequence and no `program` keyword at all** — as in the `"Hello, world!"` example above. `program (params) { … }` is what you reach for once you take inputs, and it therefore always carries **at least one** parameter. Each parameter is an ordinary fixed slot whose initializer is the *user*; the required annotation is honest, since there is nothing to infer.
- **`program` is terminal — nothing may follow it** (`S0030`). Everything *before* it is unrestricted (imports, `type`s, function bindings, input-independent setup, run top-to-bottom); its body is the input-dependent finale, and its block value is the program's output. Assigning to a program input is `N0004`; an empty body is `S0029`.
- **Empty parentheses are an error — `program ()` is banned** (`S0028`). The parens hold the parameter list, so they appear only when there *is* one; a program with no inputs is the bare statement sequence, not `program () { … }` and not `program { … }`. (This is the one place the implementation is stricter than the full whitepaper's prose, which floats a no-input `program { … }` form that the parser does not accept — semicolons terminate every statement, §2, so a brace-delimited `program` head only exists paired with an input list.)
- **Inputs are gathered and validated at the boundary before the body runs** — the environment (or the CLI, via `--flag value` pairs) builds one input per parameter and validates each to its declared type, so the body never runs with a bad value and stays synchronous and pure. **v0.1 admits the four scalars** — `String` → text, `Int`/`Float` → number field (re-asks on `"abc"`), `Bool` → checkbox.
- **`program` over `main`, and the graduation it sets up.** `main` is jargon (main *what*?). And because `program (params) { body }` echoes a function's shape, a learner who later writes `fix f = fn(params) => { body }` already recognizes the params-then-block pattern — the entry point was close to their first function all along, short the return type and the `=>` that a function's body always needs.

> **Not in v0.1:** the browser canvas and the **UI / MVU model** — `Element`, `Command`, `view`/`update`, message values, subscriptions. Structured inputs (records, unions → dropdown, `T?`, `List<T>`) beyond the four scalars are also deferred.

---

## 12. Implementation

Ascent is a hand-written TypeScript pipeline over four independent stages, each with its own AST shape:

```
source → Lexer → tokens → Parser → Program (untyped AST)
       → Typechecker → TypedProgram → Interpreter → RuntimeValue
```

- **Hand-written lexer and recursive-descent parser — no generators**, because error messages are the product and generated parsers produce poor ones. The lexer is stateful (string interpolation flips between string- and expression-mode; `#[ … ]#` nests), lossless, and total. Expression precedence uses **Pratt parsing**. Every parser production is a free function over a `TokenStream` (which filters trivia so the grammar sees only significant tokens), and parsing uses **panic-mode recovery** — a malformed statement can be skipped so one pass surfaces several errors, so a non-null `Program` does not by itself mean error-free; the diagnostic list is authoritative.
- **The type checker is a separate pass** producing a parallel fully-typed tree, organised around bidirectional-typing judgments (synthesis `⇒`, checking `⇐`, per-statement inference) with a `Diagnostics` accumulator and a `TypeEnv` scope chain reusable across REPL lines.
- **The interpreter is a tree-walking evaluator** over the typed program; `Environment` is a parent-chained scope, and method dispatch switches on receiver type into per-type `eval*Method` functions, mirroring the checker's `METHODS` table.
- **Value semantics is the whole runtime model** — no value mutates; “change” is rebinding a `mut` slot. (In production this rests on persistent data structures with structural sharing; the current prototype keeps the semantics, which is what the language guarantees.)

> **Design intent beyond the prototype** (from the full whitepaper, not v0.1 code): a single Rust core (lexer → parser → typechecker → bytecode → VM) compiled to WASM and a native CLI, with a fuel-based VM for friendly infinite-loop messages, stepping, and VM-scheduled async.

---

## 13. Tooling

- **REPL** — a terminal read-eval-print loop that **auto-prints each expression's value**, reusing one checker/interpreter environment across lines. It is the “inspect a value mid-development” affordance that keeps most functions late (with `program` inputs for input and the block-value rule for output, a beginner rarely needs an imported function early).
- **`assert` / `assertEqual`** (via `import … from "assert"`, §10) — the built-in on-ramp to “is my code correct?”, needing no installs.
- **Type inspection** is understood as a *tooling* concern, not a language operator — a type is a compile-time fact the tool reports, never a runtime value program source can interrogate (a runtime `typeof` would contradict the no-runtime-type-interrogation basis of the nominal type system, §6/§7). A learner can also *assert* a type actively with an annotation (`fix x: Float = a / b`), the static, checked counterpart.

> **Not in v0.1:** the zero-config formatter, the `:type` REPL meta-command, `:doc`/`:load`/`:reload`, and a dedicated test runner.

---

## Appendix — a representative v0.1 program

Behaviour on a user type lives in a **free function** (user `methods { }` is a v2 feature, §6), so a `Shape`'s area is `area(s)`, dispatched with `match`:

```ascent
type Shape =
    | Circle{ radius: Float }
    | Rect{ width: Float, height: Float };

# a free function over the union — expression body, one match
fix area = fn(s: Shape): Float => match s {
    Circle{ radius }      -> 3.14159 * radius * radius,
    Rect{ width, height } -> width * height,
};

type Player = { name: String, score: Int };

fix rank = fn(p: Player): String =>
    if (p.score >= 100) { "pro" } else { "rookie" };

program (name: String) {                   # entry form: one typed input, bound at the boundary
    fix shapes = [ Circle{ radius: 2.0 }, Rect{ width: 3.0, height: 4.0 } ];
    mut total = 0.0;
    for s in shapes {
        total = total + area(s);           # loop body ends in an assignment → Done
    };                                     # every statement is ;-terminated, the for too (§2)
    print("total area: ${total}");

    fix ada = Player{ name: name, score: 120 };
    print("${ada.name} is a ${rank(ada)}") # program's last value is the output
}
```

Run with `ascent program.asc --name Ada` (the CLI binds `--flag value` pairs to the
declared inputs), and it prints:

```
total area: 24.56636
Ada is a pro
```

---

## The v0.1 boundary at a glance

| In Core v0.1 | Deferred beyond v0.1 |
|---|---|
| Scalars, `List`, `Range`, `Optional`, `Result`, `Task` | `Map`, `Set`, `Ref`, `Char`, `Bytes`, tuples, DSL literals |
| `type` records / enums / unions *(pure data)* | **User `methods { }`**, `make { }`, `opaque type` |
| `match`, destructuring, `with`, `try` / `try…else` / `??` / `abort` / `.orAbort` | trait-gated auto error conversion (`From`) |
| `async fn` / `!` / `await` (single task) | Nurseries, combinators, channels, cancellation |
| `program (…)` entry + CLI arg binding | UI / MVU / `Element` / `Command` / subscriptions |
| `import` from the stdlib registry (`math`, `assert`) | `export`, user-authored files, external packages |
| Built-in method catalog + ambient `print` | `List.map`/`filter`/`sort`/…, `toStr` rename |
| Nominal types, narrow widening, `Never`/`Invalid`, bidirectional checking, narrowing-by-binding | User-definable **generics & traits** (the three 🔒 welds generalize here) |
| Full diagnostics (`L`/`S`/`N`/`T`/`R`); REPL (auto-print) | Formatter, `:type`, test runner, Rust/WASM VM |

*The three 🔒 welds — `for` → `Iterable`, `${}`/`print` → `Display`, `math.min`/`max` → `Comparable` — ship hard-coded in v0.1 and generalize to user-implementable traits in v2 with no change to what any existing program means. That is the whitepaper's stated guarantee, and it is why Layer 1 can be frozen now while Layer 2 keeps growing.*
