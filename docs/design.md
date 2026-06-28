# Ascent — A Teaching Language

### Design Whitepaper · v1 (draft)

> *Ascent is a small, opinionated programming language for learning to program — designed to get beginners moving quickly and carry them smoothly up into mainstream languages, with honest, see-everything mechanics and no hidden magic along the way.*

---

## 1. Design principles

These are the rules every other decision answers to.

1. **Honesty over magic.** No truthiness, no silent failure states, no two-kinds-of-nothing, no behavior hidden in lossy conversions. The one numeric coercion — an `Int` widening to `Float` — preserves the value exactly and is visible in the result type. If something happens, it's visible.
2. **Cage the footguns at the source.** Every value is a "real" value with no weird states (no `NaN`, no silent overflow, no wild `null`). The dangerous thing is made impossible or made explicit, not documented.
3. **Regular syntax; one meaning per surface.** The rule is not "one syntax per concept" — it is that the user never faces a *choice* between two independent constructs that do the same job (the `&&`-vs-`and`, `let`-vs-`const` decision tax). A transparent **abbreviation** that desugars to a single underlying thing is not a choice, it is ergonomics — so `T?` (for `Optional<T>`), `T orelse E` (for `Result<T, E>`), `${}` interpolation, `else if`, and `=>` are all allowed: each is *one* real thing with a friendlier spelling. The test is "is one form *defined as* the other?" — sugar if yes, a forbidden parallel mechanism if no.
4. **Transfer to many languages, not one.** Surface syntax builds muscle memory; clean semantics build correct mental models; where they conflict, semantics win. The divergences worth eliminating are *false friends* — the same surface meaning something different elsewhere, which fails *silently* (the `5 // 2` trap). What Ascent merely has and a target *lacks* is cheap: it's a compile error there, not a silent bug, so the learner is told and adapts. So Ascent keeps load-bearing semantics even when unique, aligns pure surface to the broad mainstream rather than to any single language, and refuses to import one language's quirks just to resemble it. Every divergence that remains is a deliberate graduation lesson.
5. **Static types, low ceremony.** Types catch mistakes early; inference removes the paperwork.
6. **Errors are the product.** Compiler and runtime messages are written as explanations naming the things the learner wrote.
7. **Power is opt-in and late.** Advanced capability (references, user-defined generics) arrives as a later chapter, not a day-one tax.

---

## 2. Lexical & syntax

- **Braces** for all blocks; **no whitespace semantics**.
- **Semicolons** terminate every statement (simplest grammar; precise parser error recovery).
- **Comments:** `#` runs to end of line (whole-line or trailing); `#[ … ]#` is a delimited block comment that may sit mid-line or span lines, and nests. **`//` is deliberately unused** — it means *comment* in the C family but *floor division* in Python, so either meaning would silently betray graduates to the other camp. Ascent uses neither (floor division is `div`, §5), so `//` builds no habit and is learned fresh per language.
- **Identifiers**: `[A-Za-z_][A-Za-z0-9_]*`. Keywords (`fix`, `mut`, `and`, `or`, `not`, `div`, `true`, `false`, `args`, `try`, `orelse`, `abort`, `import`, `export`, `from`, `async`, `await`, `spawn`, `concurrent`, `trait`, `implement`, `requires`, `Self`, and the control-flow/type words) are reserved. The last four are held ahead of the traits feature (§16) — reserved now so no program breaks when it lands, even though they are not yet usable.
- **Mandatory braces** on every `if` / `for` / `while`, even single-line (no dangling-else, no goto-fail class of bug). The *test* of `if` / `while` / `match` is parenthesized — `if (cond) { }` — easing the move to TypeScript and the C family; `for` takes no parens (it has no test).
- **Expression-oriented: every block yields the value of its last statement** — a branch, a loop body, a function body, and the whole program alike (one rule, no special cases). The trailing semicolon is optional exactly as a list's trailing comma is — `{ a; b; c }` ≡ `{ a; b; c; }` — never load-bearing for the value. A last statement that isn't a value (a declaration, an assignment) yields `Done`.

---

## 3. Slots

A **slot** is a named, value-holding location — *variable* in the colloquial sense. The mental model is **name → slot → value**: the name labels the slot, the slot holds the value. A slot is a *container, not a reference* — assignment copies (value semantics, §4), so writing through one slot can never reach another.

Every slot is declared **fixed** or **mutable** on a single axis, with no default:

```ascent
fix name = "Ada";    # a fixed slot — the name cannot be reassigned
mut count = 0;       # a mutable slot
count = count + 1;   # fine; would be an error on a fixed slot
```

- **`fix` / `mut` are stated on every slot — there is no default** (unlike Rust/Swift's immutable-default or C/Java's mutable-default). Nothing about a declaration depends on a rule you must recall; each line is legible alone, and every declaration forces the "does this change?" question. It costs less here than elsewhere: the usual reason to *default* to immutable is to prevent aliasing surprises, and value semantics has already removed those. (In prose we say "create a fixed slot," never "fix a slot," to keep `fix` clear of the "fix a bug" sense.)
- **`fix` constrains the slot** (rebinding the name), not the deep mutability of the value — that is a separate axis the same `fix`/`mut` pair will extend to later, by design (one concept, not two).
- Graduation: this is `let` / `let mut` in Rust, `val` / `var` in Swift and Kotlin, `const` / `let` in JavaScript — note `let` flips between *immutable* (Rust) and *mutable* (JS), a clash `fix`/`mut` sidesteps by belonging to no one.

---

## 4. Values & types (the value universe)

### Scalars
- **`Int`** — 64-bit signed, written `42`. **Traps on overflow** with a friendly message (no silent wraparound); promotes to `Float` in mixed arithmetic (§5). No width/unsigned zoo in v1.
- **`Float`** — 64-bit IEEE 754, written `3.14` (a digit is required on *both* sides of the point — no `3.` or `.5`; exponents and digit separators are deferred). **`NaN`/`Infinity` are runtime errors**, not values, so every `Float` is a real, ordered number.
- **`Bool`** — `true` / `false`. **No truthiness**; conditions must be `Bool`.
- **`String`** — immutable Unicode sequence, written with double quotes (`"..."`) and `${expr}` interpolation (`"Hi ${name}"`); single quotes are unused. Interpolation is always on but triggers only on `${`, so literal braces need no escaping (`"{}"` is two characters) and a lone `$` is literal; escape a literal `${` as `\${`. **No integer indexing** (avoids the Unicode-index bug class); `length` counts code points. **No `Char` type** — characters are length-1 strings.

### The "no information" value
- **`Done`** — the unit type, the value of statements/side-effecting calls (`print : fn(String) -> Done`).
- It has exactly one value; written `{}` (an empty block). **No `done` keyword**, so `done` stays free as a variable name.

### Absence
- **`none`** — the one absent value. **`T?` is sugar for `Optional<T>`** — an ordinary union (`none` or a value), not a special form; `String?` means "String or none," and a bare `String` can never be none. The recovery tools live in §9 (`??` to default, `try` to propagate, `match` to inspect).
- **Flow typing** narrows `T?` to `T` after a `!= none` check. **`??`** supplies defaults — on `Optional` only (a `Result`'s error must be acknowledged, not silently defaulted; §9).
- No `undefined`, no second kind of nothing. `none` stands alone — no `Some`/`None` pairing to teach — chosen for familiarity with Python, the dominant first language.

```ascent
fix nick: String? = none;
fix shown = nick ?? "anonymous";
```

### Compound
- **`List<T>`** — homogeneous: one element type `T`, every element a `T` (this is what makes `for x in xs` give each `x` the same type and `.map`/`.filter` honest). A literal `[1, 2, 3]` infers `T` as the **least common type of its elements**: all `Int` → `List<Int>`; all the same type `T` → `List<T>`; an `Int`/`Float` mix → `List<Float>` (the `Int`s promote — the same one-way rule as §5, so `[30, 30.5, 31]` is `List<Float>`, but `[30, 31]` stays `List<Int>`). Elements with no common type (`[1, "x", true]`) are a compile error — to mix shapes, name them as a union and use `List<ThatUnion>`. The "least common type" relation is exactly as wide as value promotion and no wider (just `Int`→`Float`); it is *not* subtyping (§7). The empty `[]` has no elements to infer from, so it takes its type from context (`fix xs: List<Int> = []`); a bare `fix xs = []` is the annotation-required error (§7). Growth is gated by a `mut` slot.
- **`Map<K, V>`** — literal form; lookup returns `V?`.
- **`Range`** — `a..b`, **half-open** (`0..n` yields exactly `n` items), iterable (`for i in 0..n`); matches Python and Rust and pairs cleanly with lengths. Replaces the C-style `for`.
- **Functions** — first-class values; comparing functions with `==` is a compile error.

### Excluded from v1
Tuples (use a named type), `Set`, `Bytes`, sized/unsigned ints, `Char`.

### Value vs reference semantics
- **Value semantics everywhere** — assignment is conceptually a copy; no aliasing. Implemented via structural sharing + copy-on-write, so it's cheap.
- **`Ref<T>`** is the single, explicit, late-introduced escape hatch for shared mutable / cyclic data (a safe GC'd box; `get`/`set`). No addresses, no `&`/`*`, no pass-by-reference — **everything is passed by value**; a `Ref` is a value that happens to hold a shared slot, and that sharing is visible in the type.

---

## 5. Expressions & control flow

- **`if (cond) { } / else if (cond) { } / else { }`** are **expressions** (no separate ternary). The test is parenthesized (C-family/TS surface) even though the mandatory body braces already delimit it. `else if` is the only control-flow sugar.
- **`match (subject) { }`** — an expression, **exhaustiveness-checked**. v1 patterns are shallow: variant + field binding, literals, `_`. (No nested patterns, guards, or or-patterns in v1.) Chosen over `switch` to avoid fallthrough/`break` expectations.
- **`while (cond) { }`** for condition loops. **`for x in xs`** iterates values and takes **no** parens — it has no test, and parenthesizing it would mimic TypeScript's *key*-iterating `for…in`, the very false friend the `in`-for-values choice avoids. No C-style three-part `for`. **Both are statements that yield `Done`** — a loop has no single meaningful result (an empty collection, or a `while` that runs zero times, has no last value to give), while a provably-infinite `while (true)` is typed `Never` (§7). Producing a value *from* a sequence is the collection API's job — `reduce`, `find` (→ `T?`), `map`, `filter` — never loop-return; this keeps the block-value rule (§2) special-case-free, since a loop body's last statement is an effect yielding `Done`.
- **Operators are words**: `and` / `or` / `not` (operate on `Bool` only — consistent with the word-first keyword set and no-truthiness).
- **`==`** is structural; operands must share a type, except that `Int` and `Float` compare as numbers (`1 == 1.0` is `true`, via the one-way promotion below). Other cross-type comparison (e.g. `Int` vs `String`) is a compile error. **`<` `>` `<=` `>=`** work on `Int` / `Float` / `String`, with the same `Int`/`Float` mixing allowed.
- **Numbers promote one way — `Int` → `Float`, never back.** When an `Int` meets a `Float` in arithmetic or comparison, the `Int` becomes a `Float` (value-preserving). So `+`, `-`, `*` yield an `Int` only when *every* operand is an `Int`, and a `Float` the moment any operand is a `Float`. A `Float` is never silently narrowed to an `Int` — that needs an explicit `.toInt()` (§6). No other implicit conversions, and no operator overloading.
- **Division.** `/` **always yields a `Float`**, whatever the operands — `10 / 2` is `5.0`, `7 / 2` is `3.5` — so the silent integer-truncation bug simply can't occur. **`div`** is whole-number floor division on `Int` operands only (`7 div 2 -> 3`); using it on a `Float` is an error. Floor rounds toward −∞ (pairing with a future `mod`); division by zero is the loud crash of §9. Spelled `div` rather than `//`, which collides — comment in the C family, floor division in Python (§2). Graduation note: `/` is real division in Python too; C/Java/JS instead truncate `int/int`, so they need a `Float` operand or `Math.floor` to match.
- **Operator precedence**, loosest to tightest: `or` · `and` · `not` · comparisons (`== != < <= > >=`, non-associative — no chaining) · `+ -` · `* / div` · unary `-` · atoms (literals, identifiers, parenthesized expressions). Binary arithmetic is left-associative. Follows Python in one respect: `not` binds looser than comparison, so `not a == b` parses as `not (a == b)`. The expression parser is Pratt-style (§12).
- **Function bodies are just blocks.** `fn(...) -> T { … }` yields the value of its last statement (§2) — no `return` needed. The single-expression form `fn(...) -> T => e` is sugar for `{ e }`; `=>` reads as "the result is this expression." Use whichever fits — they mean the same thing (so `=> {` is merely redundant, a style nit, not an error).
- **`return`** is an **early exit** from the enclosing function, used only to leave *before* the last statement. Reaching the end is the normal path, and the body's value is that last statement (§2).
- **Closures capture by value.** A function may use names from the scope where it was defined (`fn(x) -> Int => x + base` uses `base`), and it **snapshots their values at the moment it is created** — later changes to the outer slot do not affect it. This is not an arbitrary pick: it is value semantics (§3) extended to closures, so the whole language obeys one rule — names hold values, and what a closure remembers is a value too, never a live reference to someone else's slot. The famous loop footgun therefore cannot occur — building `fn() => i` three times in a `while` loop captures `0`, `1`, `2` (the snapshots), not three views of a single mutated `i` that all read `3` (the capture-by-reference result JS shipped, then patched with per-iteration `let`). A closure captures **only the outer names it actually uses**, keeping it cheap and its dependencies legible. The rare case where a closure *should* track later mutation — shared evolving state — is exactly `Ref<T>` (§4): captured by value like everything else, but it *holds* a shared slot, so the sharing is opt-in and visible in the type rather than the silent default of every closure.

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

- A single unnamed variant takes the type's name as its tag (the canonical record form above).
- **Field access rule:** `e.field` is legal **iff `e`'s type has exactly one variant**. Multi-variant types must be inspected with `match`. (The error message itself teaches sum types.)
- Variants are scoped to their type; unqualified names resolve when context is unambiguous, else `Shape.Circle{...}`.
- **Construction requires a declared type.** Values are built as `TypeName{ field: value, ... }`; there are no anonymous record literals, and a `type` is never created implicitly from a construction site — so a misspelled type or field name is a caught error, not a silently-new type. External JSON is parsed *into* a declared type at the boundary (returning `T?`), keeping the language nominal while putting interop in the stdlib.
- **Why lists infer their type but records don't.** `[1, 2, 3]` infers `List<Int>` because a list has one degree of freedom — the *element type* — while its structure (a sequence) is fixed by `List`. A record literal `{ name: "Martin", age: 21 }` would instead have to invent a whole *shape* (field names, field types, the fact that exactly these fields travel together) — conjuring a new type from a value. Allowing that means **structural typing** (a type defined by its shape, e.g. `Object<{name: String, age: Int}>`) — a second type system beside the nominal `type`s (§7), and it reopens what construction closed: `{ nmae: "Martin" }` would be a valid value of a *different* inferred type rather than a caught typo. So the line is **containers infer their contents; concepts get named.** You write `type Person = {...}` once; then `Person{...}` is field-checked, inferred everywhere (`fix p = Person{...}` needs no annotation), and can carry methods. Naming the shape is the modeling lesson, not ceremony.
- **Unions are named and tagged — no anonymous `Int | String`.** A type that is "one of several shapes" is a concept, so it is named with tagged variants (`type Token = Number{...} | Word{...}`), never written inline as a bare structural union. This is the record rule in sum-type form: an anonymous `Int | String` would force exactly what tagged-nominal avoids — **runtime type interrogation** (the only way to use such a value is to ask "Int or String?", i.e. carry reflective type info on bare values), **structural typing** (a type defined by its member set rather than a declared name — the door §7 already shut for records), and a **flow-narrowing sublanguage** (TypeScript-style `typeof` analysis, with its forgets-across-calls edge cases). A tagged value instead *announces* its case, so you `match` the tag it already carries — no reflection, no narrowing, no un-named sprawl. Closed enums (`type Size = Small | Medium | Large`) and payload unions (`Shape`) are both fine; only the *anonymous, untagged* union is refused. The cost is deliberate: combining error types means declaring `type AppError = Read{...} | Parse{...}` rather than writing `ReadError | ParseError` inline (§9) — the right tax for a type system with no runtime interrogation.
- **A constructor is named-field syntax, not a first-class function** (a plain function is positional; named construction is not). To pass construction where a function is expected, write a lambda — `fn(t: String) -> Msg => EditDraft{ text: t }`. Turning a constructor into a function directly, via placeholder sections (`EditDraft{ text: _ }`), is a v2 candidate (§14), not a v1 feature.
- **Record update with `...`.** `T{ ...base, field: value, ... }` builds a new `T` equal to `base` with the listed fields overridden. Exactly one spread is allowed and it comes first; `base` must already be a `T` (no structural merge of other types); the overriding fields cannot introduce a field absent from `T`, so typos are still caught. It applies to single-variant types — a union value is `match`ed into a known variant first. There is no shallow-copy trap: value semantics make the copy a value all the way down. (Three-dot `...` stays distinct from the two-dot `..` range.)
- **Methods yes; classes, inheritance, and subtyping never.** A type may carry methods — behavior with an explicit `self` receiver — but there are no classes, no inheritance, and no subtype hierarchies, permanently (they'd require subtyping, which §7 forecloses). Methods resolve nominally on a value's concrete type; the model is the Rust/Go struct, not class-OOP. Data and behavior are still declared as distinct kinds of member (fields vs methods), never fused into an opaque object.

### Methods and free functions

Behavior attaches to a type through an optional **`methods`** clause on its definition — so a type and everything it can do are declared in exactly one place, never scattered across the codebase:

```ascent
type Player = {
    name: String,
    score: Int,
} methods {
    greeting:  fn(self) -> String => "Hi, ${self.name}",
    withScore: fn(self, points: Int) -> Player =>
        Player{ name: self.name, score: self.score + points },
};
```

- **Fields and methods are both *members*,** declared with the same `name: …` syntax and separated by commas. (`fix`/`mut` declare a *slot* inside a scope — top level or a function body — and never appear inside a type. The colon does subtly different work in each case: a field's right side is a *type*, a method's is an *implementation* — which mirrors the `name: value` of construction.) Method bodies use the same two forms as any function: `=> e`, or a `{ … }` block whose value is its last statement (§2).
- **The receiver is an explicit `self`** — the one parameter that needs no annotation, because its type is fixed by the enclosing type. This keeps the mechanic visible: a method is just a function whose first argument is the receiver, the same `self` a learner later meets in Python.
- **The dot accesses one member, resolved statically:** a field (`p.name`) or method (`p.greeting()`) of a value, or an export of a namespace-imported module (`geometry.distance`, §10). `x.f()` resolves to exactly one target — a method on `x`'s concrete type, or an error — with no hidden free-function call, no dispatch, no inheritance chain. Module qualification is the same idea: one statically-known target, never a search.
- **Methods on a union** dispatch internally with `match (self)`; the field-access rule still holds, so a multi-variant value exposes methods but no direct fields:

```ascent
type Shape =
    | Circle{ radius: Float }
    | Rect{ width: Float, height: Float }
methods {
    area: fn(self) -> Float => match (self) {
        Circle{ radius }      -> 3.14159 * radius * radius;
        Rect{ width, height } -> width * height;
    },
};

fix a = Circle{ radius: 2.0 }.area();   # a real method on Shape
```

- **Free functions coexist** for operations not naturally "on" a type (`fix double = fn(x: Int) -> Int => x * 2`, called `double(5)`). Each operation is a method *or* a free function — decided once by whoever defines it — so there is exactly **one way to call it**. (This is precisely what UFCS gave up: it let every function be called two ways.)
- **Which one — the test.** An operation is a **method** when it is an intrinsic capability of *one* type and reads as "ask this value to…", especially when it *chains*: `list.map(f)`, `string.trim()`, `circle.area()`. It is a **free function** when it is an action performed *on* a value from outside (`print(x)`), a symmetric operation *between* values that no single one owns (`max(a, b)`), or a producer with no natural receiver. The dividing question is ownership: a capability *of* the type, or an operation merely *involving* it.
- **`print` is free because it must accept any value** — and there is no `Any` / universal supertype to hang a method on (§7). That boundary is forced by the type system, not a style call: an operation that must work uniformly across every type cannot be a method.
- **Conversions are methods:** `x.toStr()`, `x.toInt()`, `x.toFloat()`, `x.toBool()` — one uniform `to`-family (the `toInt`/`toFloat` of §5 are exactly these). "A value knows how to become another type" is an intrinsic capability; it chains inside interpolation (`"total: ${sum.toStr()}"`); and it yields one rule instead of the ragged "`str` is free but `length` is a method." Built-in types ship these methods (next bullet).
- **Real method chaining** — `xs.map(double).filter(isEven)` — is genuine, not sugar over nested calls, and it is the mainstream idiom, so it transfers directly. No pipe operator is needed or provided.
- **You cannot add methods to a type you don't own** in v1; built-in types ship their own methods. Extending an existing type is a deliberate v2 feature, not an accident — and that contrast will later teach the difference between a type's own behavior and a bolted-on extension.

---

## 7. Type system

The governing move: the checker mainly answers one question — *"are these two named types the same?"*

- **Nominal typing.** A `User` is a `User` because it was declared one (simple to implement, clear errors, predictable).
- **No subtyping.** No inheritance, no implicit widening, no variance. The cracks are two hard-coded widening rules, not a system: a non-null `T` is usable where `T?` is expected, and `Never` (below) is usable as any type. Methods don't disturb this: `x.f()` is a nominal lookup of `f` on `x`'s concrete type — at most one match, with no overloading and no dispatch hierarchy to search.
- **`Never`, the bottom type — machinery, not vocabulary.** A few expressions *diverge*: they never produce a value — `abort` (§9), `.orAbort()` on its failing case, a bug-tier crash, the bad-case arm of `try` (it `return`s), and an infinite loop. Their type is `Never`, which is assignable to *every* type. That is what lets a `match` arm `abort` while the arm beside it yields an `Int` (the `abort` arm satisfies `Int`), and lets a `match` whose `Err` arm `return`s still take the type of its `Ok` arm; it also underpins exhaustiveness and reachability checking. In v1 `Never` is **not a type anyone writes** — no `-> Never` annotations — it lives in the checker and surfaces only as plain diagnostics ("this line can't run — the line above always aborts"). The same hide-the-abstraction move as the monad behind `try` (§9).
- **Inference lives only on slots.** Every function signature is fully explicit — **both parameter and return types are mandatory** — so nothing about a function's type is reconstructed from its body, errors stay local and name real types, and recursion needs no special case. A slot's type is inferred from its initializer; generic *type arguments* at call sites are still inferred automatically (you never write `map<Int, Int>`). Implemented via **bidirectional type checking** (bounded, no global unification). Wrinkle: a slot whose initializer carries no type information (a bare `[]` or lone `none`) needs an annotation.
- **Generics are consumable, not definable** in v1 (`List<Int>`, `Map<K,V>`, stdlib `map`/`filter`). The only polymorphism is built-in operators + stdlib generics — no interfaces/typeclasses/overloading yet. The compatible future path for shared behavior is trait/typeclass-style contracts (polymorphism *without* subtyping, à la Rust traits) — a v2 candidate that rides alongside user-definable generics, never class inheritance.
- **Types describe data; they do not compute** (no type-level computation).

---

## 8. Async & concurrency

**Colored `async` / `await` — the convergent mainstream surface.** An `async` function is marked at its definition, and async-ness *propagates*: a function that `await`s is itself `async`, and its caller awaits its result. This is deliberately the **colored** model that JS, TypeScript, Python, Rust, and Swift all share — not a "colorless" scheme — because the color is *true, transferable knowledge*: a graduate meets exactly this everywhere. I/O is async, with **one** version of each operation (no `readLine` / `readLineSync` pair — pretending I/O is instant is the lie). Execution is **eager** (JS/Python-like): calling an async function starts it, matching the beginner's intuition that "calling a function runs it" (Rust's lazy futures, where the call does nothing until awaited, are the surprising minority and are not used).

```ascent
async fn fetchUser(id: Int) -> User {
    fix response = await httpGet("/users/${id}");
    parseUser(response)
}
```

**What `await` *means* — the teaching line, because the usual one is wrong.** `await` does **not** mean "this takes a long time" (a 30-second loop takes long and is never awaited). It marks where **your program is not the one doing the work**: it has handed a job to something slower than the CPU — the disk, the network, another machine — and is *waiting* on that, idle, not computing. `await` is the visible **edge in time** between your program and the slow outside world — the same boundary as `args` (input *before* the run) and effects (§11), now *during* it. You `await` what you **delegate**, never what you **compute**. (Even in a one-off script with no other work to overlap, `await` still marks the honest pause; overlapping others' work is a bonus when there are others, not the reason.)

**`await` and `try` compose orthogonally** (§9): they answer different questions — `await`, "*when* is the value ready?"; `try`, "*what if* it failed?". A read that is both slow and fallible stacks them, inside-out in the real order of events:

```ascent
fix lines = try await readLines(path);   # wait for the disk, THEN handle failure
```

`await` resolves the timing (suspend until the read settles); the settled value is an ordinary `Result`, so `try` then unwraps-or-propagates it. `await try` is therefore not a valid order — there is no `Result` to `try` until `await` has produced one. After the `await` the result is a normal `Result`, so the whole §9 toolkit applies: `match (await readLines(path))`, or `(await readLines(path)).orAbort()` for the script case.

**Concurrency: `spawn` splits "start" from "wait".** Plain `await fetch()` *fuses* start and wait — which is why two sequential `await`s run one-after-another, not at once. `spawn` does only the start: it launches a task and returns a **handle** immediately, without waiting, so several tasks run concurrently; `await` on the handle then collects the result. So `await fetch()` ≡ `await (spawn fetch())`, and you split them exactly when you want multiple things in flight:

```ascent
fix userTask  = spawn fetchUser(id);    # both start,
fix postsTask = spawn fetchPosts(id);   # running concurrently
fix user  = await userTask;             # then collect —
fix posts = await postsTask;            # ~1s total, not 2
```

**Structured concurrency: `spawn` lives only inside a `concurrent { }` scope**, which **does not exit until every task it spawned has finished**, and **cancels the rest if one fails**. This is the modern model (Swift / Kotlin / trio), and it kills the four unstructured-concurrency hells in one stroke — orphaned tasks that outlive their creator, errors lost because no one is left to catch them, zombie tasks no one cancels, and fire-and-forget floating promises — by giving every task a *parent scope*, lexically, exactly as a `{ }` block owns its slots. Concurrency becomes nested and visible: structured programming applied to time.

```ascent
fn loadProfile(id: Int) -> Profile orelse FetchError {
    try concurrent {
        fix user  = spawn fetchUser(id);
        fix posts = spawn fetchPosts(id);
    }                                  # join: waits for both; if either failed, the others are
                                       # cancelled and the error propagates HERE
    Profile{ user: user, posts: posts }   # reached only if BOTH succeeded
}
```

The `try` sits on the **block**, not the spawns — a `spawn` has barely started and hasn't failed yet, so failures **collect at the join** (the brace) and propagate from there. This is the concurrent twin of "multiple `try`s collect at one return type" (§9): sequential failures converge at the return type, concurrent failures at the scope.

**Staging.** A beginner's first async is a single sequential `await fetch()` (the fused common case) — *no* `spawn`, *no* `concurrent`, because they do one thing at a time. The concurrency surface appears only when "I want two slow things at once" first comes up, which is genuinely late — and `args` (§11) defers most in-program I/O, so even the first `await` lands well after the early lessons. Scheduling is at the **VM level** (suspension points are natural fuel-yield points, §12).

**Parked sub-decisions** (advanced; do not block the model): cancellation semantics (how a cancelled task unwinds), and error aggregation when *several* tasks in a scope fail at once (first-wins-and-cancel, à la Swift, vs. collect-all). Both ride with the later concurrency lessons (§15).

---

## 9. Error handling & diagnostics

- **Two tiers of failure.** A **bug** crashes loudly and uncatchably — index out of bounds, overflow, divide-by-zero — with a precise message, location, and locals; you *fix* it, you don't handle it (the right first model of failure). An **expected failure** is a **value**: its possibility sits in the return type, so it can never tunnel invisibly up the stack the way an exception can.
- **Absence is `Optional<T>`, spelled `T?`** (§4). **Failure-with-a-reason is `Result<T, E>`** — a two-case union `Ok{ value: T } | Err{ error: E }` — with the surface spelling **`T orelse E`** (`fn parse(s: String) -> Int orelse ParseError`). Both `T?` and `T orelse E` are sugar for one underlying union; `Result<T, E>` stays writable for generic code and aliases (`type IOResult<T> = Result<T, IOError>`). `orelse` reads "a T, or else an E" — a *returned value*, never a thrown, stack-unwinding exception.
- **`match` is the full handler.** A `Result`/`Optional` is just a union, so you open it with the exhaustive `match` you already have, both cases handled, the `Err`'s reason in hand. No new construct.
- **`try` is the propagation shorthand**, spanning both `Optional` and `Result`: `try expr` unwraps the good case and continues, or **early-returns the bad case from the enclosing function**. It desugars to exactly that match — `fix lines = try readLines(path);` ≡ `match (readLines(path)) { Err{ error } -> return Err{ error }; Ok{ value } -> value; }`. Because it early-returns the bad case, **a function that uses `try` must itself return a compatible `Optional`/`Result`** — the compiler enforces it, so fallibility is forced into the signature and cannot hide. Every propagation point is *visible* (you see each `try`) and *typed* (the enclosing function admits it can fail) — the exact opposite of exceptions.
- **`??` is the gentle Optional default — Optional only.** `opt ?? fallback` takes the value or, on `none`, the default. It is *not* allowed on `Result`: a `none` carries no information so defaulting it discards nothing, but a `Result`'s `Err` carries a reason, and silently dropping that reason is exactly the dishonesty Ascent refuses. So seeing `??` tells you the left side is an Optional. `Result` errors must be *acknowledged* — handled (`match` / `try` / `try…else`) or surfaced (`.orAbort()`, below) — never silently defaulted away.
- **`.orAbort(message?)` is the escape hatch that *reports the error*.** A method on `Result`/`Optional`: it unwraps the good case, or aborts through the bug-tier crash (§9 format: location + locals). On a `Result` the abort **reports the carried `Err`** — the most informative thing available — so the default for "I don't want to handle this" surfaces the real reason instead of throwing it away. The optional message *augments*, never replaces: `config.orAbort("loading settings")` shows your context **and** the underlying error. On an `Optional` (no error to carry) it aborts with a locator, plus the message if given — the honest "I asserted this is present." It is a *method* precisely because the receiver is the value, so it can read the `Err` that a bare keyword cannot. This is the "abort and log the error" default; reach for it in scripts and proven-safe spots, and — being a visible call — every such gamble is greppable.
- **`abort "reason"` is the unreachable-branch tool, not an error tool.** A diverging expression (type `Never`, §7) for the case where there is *no* error value to report — a `match` arm or `else` branch you have proven impossible, a broken invariant — so the human `reason` is the only information there is, and is therefore required. It is deliberately **outside the error-handling story**: it is never the way to "skip" a `Result` (that is `.orAbort()`, which reports the real error) and is not taught as such. It composes anywhere a value is expected because it diverges (`match (x) { A -> 1; B -> abort "B is filtered out earlier" }`).
- **No fallibility keyword on the producer side** (no `throws fn`). Asynchrony needs `async` because it is invisible *behavior* (§8); failure needs no marker because it is *data* already named in the return type. The type is the marker.
- **`await` and `try` are orthogonal and compose.** `await` turns a pending async value into a finished one; `try` unwraps-or-propagates a fallible one; stack them — `try (await fetch(url))` — with no fused `async throws` construct. Keeping them separate is what makes them composable and transferable (Rust's `result?`, Swift's `try await`).
- **Multiple `try`s collect at one return type.** Because each `try` early-returns its bad case from the enclosing function, *every* `try` in a function must propagate an error that fits that function's single declared error type. Differing sources do not combine implicitly (§6: no anonymous unions) — you declare the combining union and adapt into it.
- **`try expr else e -> mapExpr` maps the error before propagating.** On the bad case it binds the error to `e`, evaluates `mapExpr` to a *new* error, and early-returns that — adapting a foreign error into the function's declared type, explicitly, at the call site:
  ```ascent
  type SolveError = Read{ cause: ReadError } | Parse{ cause: ParseError };

  fn solve(path: String) -> Int orelse SolveError {
      fix lines = try readLines(path)     else e -> SolveError.Read{ cause: e };
      fix nums  = try parseNumbers(lines) else e -> SolveError.Parse{ cause: e };
      Ok{ value: sum(nums) }
  }
  ```
  It adds no new concept — it is the desugared `Err` arm made visible (`Err{ error: e } -> return Err{ error: mapExpr }`), reusing `match`'s `->` "arm produces" shape. So **`try` is the no-mapping shorthand and `try … else` the mapping form.** (For an `Optional`, whose bad case carries nothing, the binding is dropped: `try opt else -> SomeError{...}` turns a `none` into a propagated error.)
- **No error ever changes type implicitly** — every adaptation is a visible `else`. *Future possibility:* trait-gated automatic conversion (Rust's `From`) would let bare `try` adapt errors when a declared conversion exists; convenient, but it hides the mapping, so it stays a candidate weighed against honesty, not the plan (§15).
- **The abstraction stays hidden.** `Optional`, `Result`, and `Promise` share one shape (a monad), and `try`/`await` are both its "unwrap" — but that unity lives in the compiler and one sentence of docs, never in the surface. Each box gets its own concrete keyword, so a learner meets two simple words, not a type class.
- **No `try`/`catch`, no exceptions, ever.** Catching a *bug* inline is refused — that tier crashes by design. Keeping a long-lived system alive across a crashing sub-task is a coarse **supervised boundary** (restart/report a task without taking the system down), not inline catch — a later, advanced feature (§15).

### Diagnostics: errors are the product

Because Ascent is a teaching language, a diagnostic is a *lesson*, not a scolding. Every diagnostic, from any stage, is a structured value (`Diagnostic`) — pure data with no embedded formatting — rendered by the editor (inline squiggles, hovers, one-click fixes) or by a terminal. Each carries a plain-language headline, the source span(s) it points at (a primary plus supporting spans, each optionally labeled), an optional teaching paragraph on *why* the rule exists, zero or more machine-applicable fixes, a severity, and a stable code.

**Style contract** — every message obeys four rules:
1. **The compiler takes the blame, never the student** ("I found…", not "you wrote illegal…").
2. **Describe, don't accuse.**
3. **Always propose a concrete fix**, shown in the student's own code.
4. **The message is a micro-lesson** — it teaches the rule, because for a learner the error is the first encounter with it.

**Stable codes.** Each distinct error has a permanent, doc-referenceable code (e.g. `T0001`), allocated once and never reused or renumbered; the docs URL is derived (`…/errors/T0001`). Codes live in an **append-only registry** mapping each code to a symbolic name; compiler code references the name, never the integer, so the number lives in exactly one place.

**Five categories**, by the leading letter of the code (each letter has its own counter):
- **L — Lexical:** the characters don't form a valid token.
- **S — Syntax:** the tokens don't form valid grammar.
- **N — Name & binding:** a name/slot rule is broken (undefined name, duplicate declaration, assign-to-fixed-slot).
- **T — Type & semantic:** well-formed code breaks a static rule (Int/Float mixing, non-exhaustive `match`, wrong arity).
- **R — Runtime:** only running reveals it (division by zero, overflow, index out of bounds).

**Classify by *nature*, not by where it's caught.** The category is the *kind* of mistake, not the stage that detects it. Ascent is dynamic-first, so in early stages a type error (mixing Int and Float) fires at *runtime* — but it is a **T** code by nature, and when the static checker arrives (§12, stage 6) the *same* code fires earlier. Conversely, a constant-folded `1 div 0` stays **R**. Detection-site moves; the code never does.

---

## 10. Modules

**One file is one module; the path is its identity.** No separate namespace layer (C#'s namespaces float free of the file system) and no runtime search path or implicit-package machinery (Python's `sys.path` / `__init__.py`) — the folder structure *is* the module structure, which a beginner already understands. "Where does this name come from?" always has a local answer: the `from` clause of its import.

**Exports are marked at the definition, and named only.** A declaration is private to its file unless prefixed `export`; there are no default exports, so a name is the same everywhere it is used (no TS `import whateverName from …`):

```ascent
# geometry.ascent
export type Point = { x: Int, y: Int };
export fn distance(a: Point, b: Point) -> Float => ... ;

fn helper() -> Int => ... ;     # no export → file-private
```

**Imports come in two forms, chosen by intent — not two spellings of one thing.**

```ascent
# named: bring specific symbols into scope, used bare
import { Point, distance } from "./geometry.ascent";
fix d = distance(p, q);

# namespace: bind the whole module under one name, used qualified
import geometry from "./geometry.ascent";
fix d = geometry.distance(p, q);
```

Named imports are terse when a few symbols are used often; the namespace form keeps every use *labeled with its origin* and sidesteps collisions between modules. They are distinguished by the braces — `{ … }` is named, a bare name is the namespace binding — and that is unambiguous *precisely because there are no default exports* to compete for the braceless form. The qualified `geometry.distance` is ordinary member access (§6): one statically-resolved export, no search.

**Paths are explicit and complete.** A relative path names a real file, extension included — `"./geometry.ascent"`, `"../shapes/circle.ascent"` — with no optional extensions, no `index`-file magic, no implicit folder resolution. The string is a path and resolves to exactly that file (the opposite of TS's specifier ambiguity and Python's search path).

**External packages are deferred, but the syntax is reserved.** A *bare* specifier — no leading `./` or `../`, e.g. `import { parse } from "json"` — is reserved to mean "an external package, resolved by a mechanism defined later"; a package manager and registry are out of the teaching core. v1 is relative-path imports only, so packages can arrive later by adding a resolver, never by changing the import syntax.

**Deliberately out (for now):** re-exports (`export … from …`), and circular imports — a circular dependency is a clear error with a friendly message, not a silently-handled feature. **Wildcard imports** (pull *everything* in bare) are refused on principle: they destroy the local "where did this name come from?" answer that file-modules exist to give.

Reserved words: `import`, `export`, `from`.

---

## 11. The environment & UI model

A browser-based **canvas**. You open a code panel to write a program; a program can spawn new interactive panels onto the same canvas.

**Program input — `args`.** Before any UI (or even functions), a program asks for typed values with an `args` preamble — a parenthesized, typed list at the very top:

```ascent
args (age: Int, name: String)

"Hi ${name} — next year you'll be ${age + 1}"
```

- **Gathered and validated before the body runs.** The environment reads the `args` list, builds a fitting input dialog (one field per arg), collects the values, and **validates each to its declared type at the boundary** — type "abc" into an `Int` field and it re-asks, so the body never runs with a bad value (§6: external data is parsed into a declared type at the boundary). By the time the first body line executes, every `args` slot already holds a value, so the body stays fully synchronous and pure — no `await`, no effects.
- **What makes a type an `args` type:** it must have a single canonical input widget *and* a total-or-cleanly-validating parse from what the user types. That rule — not expressibility — decides membership, because `args` is a boundary: every admitted type is a widget to render and a garbage-input failure to handle gracefully.
- **v1 allows the four scalars**, each with one obvious control: `String` → text field (any text is valid, so it never fails), `Int` / `Float` → number field (re-asks on `"abc"`), `Bool` → checkbox. (The CLI supplies the same values as flags / stdin instead of a modal.)
- **Growth path, as the type system fills in:** an **enum** (zero-field union like `Small | Medium | Large`) → a dropdown whose options *are* the variants, so it cannot produce an invalid value — the case where types most earn their keep at the boundary (arrives with `type`, §12 stage 4); then **`T?`** → a leave-blank field yielding `none` (pending one decision — does an empty text field mean `none` or `""`?); then **`List<T>`** → an "add another" repeatable field.
- **Structured values stay out** — records, field-bearing unions, `Map`, `Ref`, and function types have no honest single widget. Don't ask for a `Point`; write `args (x: Int, y: Int)` and let the program build it. The boundary takes flat, named scalars and the program assembles richer values from them — which keeps `args` a parameter list, not an arbitrary-data deserializer.
- **Not a new slot kind.** Each arg is an ordinary fixed slot whose initializer happens to be the user rather than a literal; the required annotation is honest, since there is nothing to infer from.
- **Staged path to functions.** The `args (...)` list is written in the exact `name: Type` form of a parameter list — because that is what it is. A script is the body of an implicit `main`, and `args` is its parameter list, supplied by the environment as caller. When functions arrive (§12, stage 3) this is revealed — "that `args` line was `main`'s parameters; here is `fn`" — so the chapter-one affordance *is* the function mechanism, met in stages, with nothing unlearned.
- **Graduation note.** Real-world program arguments (`argv`, `sys.argv`, `String[] args`) arrive as a raw, positional list of *strings* the program indexes and parses itself; Ascent names them and checks their types for you — the same idea with training wheels. `prompt()` (later, once functions exist) removes the wheels by handing back a raw `String` you parse yourself.

- **UI as values.** `Element` is a stdlib tagged union — a tree of elements — so no new language features are needed: `match` + unions + first-class functions are the whole MVU basis. Buttons carry **message values**, not callbacks (no `this`, no listener lifecycle), and **exhaustiveness checking becomes a UI feature** — add a button, the compiler demands you handle its message.
- **MVU, pure.** A panel is three pure pieces: a `Model`, `view : Model -> Element`, and `update : (Model, Message) -> (Model, Command)`. `view` *returns a description* of the screen (it never draws); `update` *returns* the next model and a *description* of any effect (it never performs one). Both stay ordinary pure functions.
- **Effects as data — the honest answer to "pure code that must do I/O".** A pure `update` cannot `await fetch(...)` without becoming async and breaking the loop, so it doesn't: it returns a **`Command`**, a *value* describing an effect ("fetch this URL; deliver the result as *this* message"), and the **runtime** performs it. The runtime loop is the single impure component — written once, in the stdlib, not by users: it `await`s the next event, calls pure `update`, performs the returned command with `spawn`/`await` (§8), and feeds the result back as a new `Message`. So the async engine of §8 is the machinery and commands are the pure instructions handed to it — **users write only pure `view`/`update` returning `Element`/`Command` values, and never write `async`/`await`/`spawn`/`concurrent` to build a UI.**
- **Failure re-enters as a message.** A command that can fail (`httpGet` is `... orelse NetError`) is run by the runtime; its `Result` returns as a `Loaded{...}` or `Failed{...}` *message*, handled by pure `update` via `match`. Errors flow through the §9 model as ordinary data — never exceptions, never unhandled rejections.
- **Subscriptions** are the same idea for *ongoing* effects: a pure `Model -> Subscription` value declaring "while in this state, listen to this timer / socket." The runtime **diffs** it as the model changes and runs the active ones as model-scoped structured-concurrency tasks (§8), so starting, stopping, and resource cleanup fall out of `concurrent`-scope cancellation automatically. This is where the old `with` / resource-cleanup question resolves.
- **One boundary, three positions.** `args` (input *before* the run), `await` (waiting *during* it), and commands (effects out, results back as messages) are the same edge — between pure computation and the uncertain outside world — at different times. A teaching spine, not three disconnected features.
- **Transfer to React (the maturity target).** The deep, durable concept transfers *exactly*: **UI is a pure function of state**, unidirectional data flow, and `update : (Model, Message) -> Model` *is* React's `useReducer` reducer `(state, action) => state` — a student arrives at React already fluent in the hard part most juniors fumble for years. What does *not* match is React's **`useEffect`** (imperative effects in a hook) versus effects-as-data — and Ascent deliberately does **not** bend toward `useEffect`, because that is React's most-regretted, in-flux part and React is itself migrating *toward* declarative effects (Server Components, `use`, Suspense). Teach effects-as-data proudly as the model React is converging on; tune *vocabulary* (state, component, reducer) toward React for free verbal transfer.
- **Composability is required, not optional.** The model must support **nested view/update with local state** (sub-components), because React is built on component composition and this is the one architectural property that is both genuinely needed and painful to retrofit — flagged in §15 as the React-transfer-critical constraint the design must honor from the start.
- **Learning ramp:** (1) `print` → console panel; (2) static UI via `show(element)`; (3) `Model` + `update` returning `Command.none` always — fully interactive UIs with **no effects and no async** for several lessons; (4) `Command.fetch` / subscriptions as a later reveal, exactly when real-world I/O first appears. Effects are opt-in and late, like `await` itself.
- **Environment affordances** (cheap because state is immutable and view/update are pure): live state inspector, time-travel history scrubber, state-preserving hot reload, multiple independent panels.

---

## 12. Implementation & build path

**Built by hand, prototyped in JavaScript, hardened in Rust.**

- **Hand-written lexer and recursive-descent parser — no generators.** Error messages are the product (§6, §9), and generated parsers produce poor ones. A hand-written lexer is also the only thing that cleanly handles Ascent's *stateful* lexing: string interpolation (`${expr}` flips between string- and expression-mode) and nested `#[ … ]#` comments. Expression precedence (§5) uses **Pratt parsing** (precedence climbing). All of it ports to Rust unchanged.
- **Prototype first in JavaScript** (the author's home language) as a **tree-walking interpreter**, then port to the Rust core below. In the JS prototype, `Int` is a `BigInt` and `Float` a `number`; all-`Int` arithmetic stays exact in `BigInt`, and mixed arithmetic promotes the `BigInt` to a `number` (the one-way `Int` → `Float` rule). Honest 64-bit overflow trapping is a later refinement.
- **Dynamic first, types later.** The interpreter runs without static checking at first; the **type checker is a separate pass** added once the core works. This decouples "it runs" from "it typechecks" and keeps each stage small.

**Build stages** — each adds one slice and is runnable end to end before the next:

1. **Expressions + slots** — literals, operators, `fix`/`mut`, references; dynamic eval; a REPL that auto-prints each expression's value (no `print` yet). Assign-to-`fix`, assign-to-undeclared, and redeclaration are errors; single global scope.
2. **Control flow** — `if`/`else if` expressions, `while`, blocks + lexical scope.
3. **Functions** — `fn` values, calls, parameters, `return`, both body forms; `print` becomes a real builtin.
4. **Types + data** — `type` records/unions, construction, field access, `match` + exhaustiveness.
5. **Methods**, then collections + stdlib (`map`/`filter`), then strings + interpolation.
6. **Static type checker** — a separate pass over the working AST.
7. **Environment** — modules, async, the MVU/UI runtime.

**Target architecture** (what the prototype graduates into):

- **One Rust core** (lexer → parser → typechecker → bytecode → VM) compiled two ways: **WASM** for the browser environment, and a **native CLI** for Linux (same crate — single source of truth). Rust's enums/`match` mirror the language's own semantics.
- **Bytecode VM (interpreter), not compile-to-WASM, in v1** — deliberately. It buys: **fuel-based execution** (infinite loops become friendly messages, not frozen tabs), stepping/pausing, time-travel/replay, full-context errors, real 64-bit `Int`, and VM-scheduled async.
- **Runtime topology:** VM runs in a Web Worker; `view` emits an `Element` tree as plain data; a thin TypeScript shell diffs and renders it; events return as messages. The process boundary sits exactly on the trust boundary.
- **Local-first:** no backend, static hosting, programs run on the user's machine.
- **Later (graduation path):** compile-to-WASM ("your program is now a real binary") and/or compile-to-JS (embed student projects in web pages) as backends bolted onto the existing frontend.

---

## 13. Tooling (v1 features, not afterthoughts)

- **Zero-config formatter** — one canonical style ends all layout arguments at format time.
- **REPL / playground.**
- **Built-in `assert` + test runner** — the on-ramp to "is my code correct?" needs no installs.

---

## 14. Out of scope

**No inheritance, no subtyping — Ascent is not class-based OOP, and never will be.** It *does* have methods (§6), but classes, inheritance, and subtype hierarchies are out for good, not just in v1. This is settled on principle: they would require subtyping, and the entire type system's simplicity (§7) rests on *not* having it — so adding them later wouldn't be a feature, it would be tearing out the foundation. Methods deliver the object-like *feel* — and real method chaining — without any of it, exactly as Rust's and Go's structs do. Shared behavior, if it ever comes, arrives as trait-style contracts that need no subtyping.

**Deferred** — a "later module," introduced when a learner asks the question it answers: interfaces / typeclasses (traits) · user-definable generics · exceptions · operator overloading · default / named arguments · placeholder sections (`T{ field: _ }` as a function, with partial application) · varargs · comprehensions · getters / setters · decorators · macros · tuples · `Set` · `Char`.

---

## 15. Open questions & backlog

The conceptual core is closed — values, slots, the numeric model, expressions, the data model (§6), the type-system spine (§7), strings, `args`, the block-value rule, and the full error model (§9) cohere, and recent questions have resolved *from* these principles rather than forcing new ones. What remains is a different character of work, grouped below by kind rather than as one sequential list. The implementation itself (the build-log, growing the interpreter one capability at a time) is the parallel execution track, separate from these design questions.

### Design frontiers — genuine design left

- **UI / effects model — core decided (§11), edges open.** The architecture is settled: pure `view`/`update` returning `Element`/`Command` values, a runtime loop that performs effects via `spawn`/`await`, subscriptions as model-scoped structured concurrency, failures re-entering as messages. Still open: what a `Command` *is* (a closed built-in set the runtime knows — the v1 answer — versus an open, user-extensible kind, which brushes traits); **composability** — nested view/update with local state, the *React-transfer-critical and retrofit-hard* property the design must honor from the start; and the async sub-decisions (cancellation semantics, multi-failure aggregation, §8).
- **Widget vocabulary.** The minimal `Element` set — genuinely library content, writable once the effects substrate above exists.

### Standard library — mostly effort, some trait-gated

- **Curated collections.** The deliberate, opinionated `List`/`Map` API you want (well beyond map/filter/reduce): which operations, named how, taught in what order. Ordering operations (`sort`, …) need the `Comparable` trait (§16), so they are gated on the generics slot.
- **String API** — `trim`/`split`/etc., and how text meets the boundary.
- **`Map` API & literals** — literal form, lookup returning `V?`, and key constraints (needs equality/hashing — trait-gated, §16).
- **Number formatting** — how `Int`/`Float` render in `${…}` and `.toStr()`.

### Core details still thin — decide with their stage

- **Collection mutation & indexing.** How a `mut` list grows (append?), element assignment (`xs[i] = v`?), and whether `xs[i]` yields `T` (crash on out-of-bounds, the bug tier) or `T?`. Leaning crash-tier; not nailed.
- **Equality & ordering on user types.** Structural `==` is decided; *ordering* (and *hashing* for `Map` keys) need `Comparable`/`Hashable` traits (§16).

### The generics / traits slot

- **The single most important forward-compat decision** — user-definable generics *and* trait-style contracts, designed so they drop in without breaking changes. Concrete design already in **§16**; it gates the trait-dependent items above (ordering, hashing, auto error-conversion, the construction-site interaction).

### Deferred by design — parked, correctly late

- **`Ref` surface** — `get`/`set` vs a `.value` field; identity vs structural equality once `Ref` exists. For cyclic data.
- **Construction-site type inference** — an expected type supplies the constructor name (`fn f() -> Person => { name: "A", age: 1 }`); downward propagation through the bidirectional checker (§7), nominal, *no* anonymous records; interacts with the generics slot.
- **Automatic error conversion (candidate, not committed)** — `From`-style hidden adaptation for bare `try`, weighed against honesty; revisit only if `try … else` proves noisy in real code (§9).
- **Supervised crash-recovery boundary** — isolate and restart/report a task that hits a bug, without making crashes catchable inline; preserves the two-tier model (§9).
- **`args` empty field** — does an empty text field mean `none` or `""` (§11)?

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

---

## Appendix — a representative program

```ascent
type Shape =
    | Circle{ radius: Float }
    | Rect{ width: Float, height: Float }
methods {
    area: fn(self) -> Float => match (self) {     # a method, expression body
        Circle{ radius }      -> 3.14159 * radius * radius;
        Rect{ width, height } -> width * height;
    },
};

type Player = {
    name: String,
    score: Int,
} methods {
    rank:     fn(self) -> String => if (self.score >= 100) { "pro" } else { "rookie" },
    describe: fn(self) -> String => "${self.name} is a ${self.rank()}",
};

fix main = fn() -> Done {                       # a free function, block body
    fix shapes = [ Circle{ radius: 2.0 }, Rect{ width: 3.0, height: 4.0 } ];
    mut total = 0.0;
    for s in shapes {
        total = total + s.area();                # method call on a union
    }
    print("total area: ${total}");

    fix ada = Player{ name: "Ada", score: 120 };
    print(ada.describe());                       # describe calls self.rank()
};
```
