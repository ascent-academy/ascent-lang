# Ascent — A Teaching Language

### Design Whitepaper · v1 (draft)

> *Ascent is a small, opinionated programming language for learning to program — designed to get beginners moving quickly and carry them smoothly up into mainstream languages, with honest, see-everything mechanics and no hidden magic along the way.*

---

## 1. Design principles

These are the rules every other decision answers to.

1. **Honesty over magic.** No truthiness, no silent failure states, no two-kinds-of-nothing, no behavior hidden in lossy conversions. The one numeric coercion — an `Int` widening to `Float` — preserves the value exactly and is visible in the result type. If something happens, it's visible.
2. **Cage the footguns at the source.** Every value is a "real" value with no weird states (no `NaN`, no silent overflow, no wild `null`). The dangerous thing is made impossible or made explicit, not documented.
3. **Regular syntax, minimal sugar.** One way to do each thing. Three deliberate exceptions: string interpolation, `else if`, and the `=>` expression-body shorthand for functions.
4. **Transfer to many languages, not one.** Surface syntax builds muscle memory; clean semantics build correct mental models; where they conflict, semantics win. The divergences worth eliminating are *false friends* — the same surface meaning something different elsewhere, which fails *silently* (the `5 // 2` trap). What Ascent merely has and a target *lacks* is cheap: it's a compile error there, not a silent bug, so the learner is told and adapts. So Ascent keeps load-bearing semantics even when unique, aligns pure surface to the broad mainstream rather than to any single language, and refuses to import one language's quirks just to resemble it. Every divergence that remains is a deliberate graduation lesson.
5. **Static types, low ceremony.** Types catch mistakes early; inference removes the paperwork.
6. **Errors are the product.** Compiler and runtime messages are written as explanations naming the things the learner wrote.
7. **Power is opt-in and late.** Advanced capability (references, user-defined generics) arrives as a later chapter, not a day-one tax.

---

## 2. Lexical & syntax

- **Braces** for all blocks; **no whitespace semantics**.
- **Semicolons** terminate every statement (simplest grammar; precise parser error recovery).
- **Comments:** `#` runs to end of line (whole-line or trailing); `#[ … ]#` is a delimited block comment that may sit mid-line or span lines, and nests. **`//` is deliberately unused** — it means *comment* in the C family but *floor division* in Python, so either meaning would silently betray graduates to the other camp. Ascent uses neither (floor division is `div`, §5), so `//` builds no habit and is learned fresh per language.
- **Identifiers**: `[A-Za-z_][A-Za-z0-9_]*`. Keywords (`fix`, `mut`, `and`, `or`, `not`, `div`, `true`, `false`, `args`, and the control-flow/type words) are reserved.
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
- **`none`** — behaves purely as an **Optional**. Lives in the type: `String?` means "String or none"; bare `String` can never be none.
- **Flow typing** narrows `T?` to `T` after a `!= none` check. **`??`** supplies defaults.
- No `undefined`, no second kind of nothing. `none` stands alone — no `Some`/`None` pairing to teach — chosen for familiarity with Python, the dominant first language.

```ascent
fix nick: String? = none;
fix shown = nick ?? "anonymous";
```

### Compound
- **`List<T>`** — literal `[1, 2, 3]`; growth gated by a `mut` slot.
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
- **`while (cond) { }`** for condition loops. **`for x in xs`** iterates values and takes **no** parens — it has no test, and parenthesizing it would mimic TypeScript's *key*-iterating `for…in`, the very false friend the `in`-for-values choice avoids. No C-style three-part `for`.
- **Operators are words**: `and` / `or` / `not` (operate on `Bool` only — consistent with the word-first keyword set and no-truthiness).
- **`==`** is structural; operands must share a type, except that `Int` and `Float` compare as numbers (`1 == 1.0` is `true`, via the one-way promotion below). Other cross-type comparison (e.g. `Int` vs `String`) is a compile error. **`<` `>` `<=` `>=`** work on `Int` / `Float` / `String`, with the same `Int`/`Float` mixing allowed.
- **Numbers promote one way — `Int` → `Float`, never back.** When an `Int` meets a `Float` in arithmetic or comparison, the `Int` becomes a `Float` (value-preserving). So `+`, `-`, `*` yield an `Int` only when *every* operand is an `Int`, and a `Float` the moment any operand is a `Float`. A `Float` is never silently narrowed to an `Int` — that needs explicit `toInt`. No other implicit conversions, and no operator overloading.
- **Division.** `/` **always yields a `Float`**, whatever the operands — `10 / 2` is `5.0`, `7 / 2` is `3.5` — so the silent integer-truncation bug simply can't occur. **`div`** is whole-number floor division on `Int` operands only (`7 div 2 -> 3`); using it on a `Float` is an error. Floor rounds toward −∞ (pairing with a future `mod`); division by zero is the loud crash of §9. Spelled `div` rather than `//`, which collides — comment in the C family, floor division in Python (§2). Graduation note: `/` is real division in Python too; C/Java/JS instead truncate `int/int`, so they need a `Float` operand or `Math.floor` to match.
- **Operator precedence**, loosest to tightest: `or` · `and` · `not` · comparisons (`== != < <= > >=`, non-associative — no chaining) · `+ -` · `* / div` · unary `-` · atoms (literals, identifiers, parenthesized expressions). Binary arithmetic is left-associative. Follows Python in one respect: `not` binds looser than comparison, so `not a == b` parses as `not (a == b)`. The expression parser is Pratt-style (§12).
- **Function bodies are just blocks.** `fn(...) -> T { … }` yields the value of its last statement (§2) — no `return` needed. The single-expression form `fn(...) -> T => e` is sugar for `{ e }`; `=>` reads as "the result is this expression." Use whichever fits — they mean the same thing (so `=> {` is merely redundant, a style nit, not an error).
- **`return`** is an **early exit** from the enclosing function, used only to leave *before* the last statement. Reaching the end is the normal path, and the body's value is that last statement (§2).

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
- **The dot has exactly one meaning — a member of this value:** a field (`p.name`) or a method (`p.greeting()`). `x.f()` resolves to a method declared on `x`'s concrete type, or it is an error — no hidden free-function call, no dispatch, no inheritance chain.
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
- **Real method chaining** — `xs.map(double).filter(isEven)` — is genuine, not sugar over nested calls, and it is the mainstream idiom, so it transfers directly. No pipe operator is needed or provided.
- **You cannot add methods to a type you don't own** in v1; built-in types ship their own methods. Extending an existing type is a deliberate v2 feature, not an accident — and that contrast will later teach the difference between a type's own behavior and a bolted-on extension.

---

## 7. Type system

The governing move: the checker mainly answers one question — *"are these two named types the same?"*

- **Nominal typing.** A `User` is a `User` because it was declared one (simple to implement, clear errors, predictable).
- **No subtyping.** No inheritance, no implicit widening, no variance. The only crack: a non-null `T` is usable where `T?` is expected — a single hard-coded widening rule, not a system. Methods don't disturb this: `x.f()` is a nominal lookup of `f` on `x`'s concrete type — at most one match, with no overloading and no dispatch hierarchy to search.
- **Inference lives only on slots.** Every function signature is fully explicit — **both parameter and return types are mandatory** — so nothing about a function's type is reconstructed from its body, errors stay local and name real types, and recursion needs no special case. A slot's type is inferred from its initializer; generic *type arguments* at call sites are still inferred automatically (you never write `map<Int, Int>`). Implemented via **bidirectional type checking** (bounded, no global unification). Wrinkle: a slot whose initializer carries no type information (a bare `[]` or lone `none`) needs an annotation.
- **Generics are consumable, not definable** in v1 (`List<Int>`, `Map<K,V>`, stdlib `map`/`filter`). The only polymorphism is built-in operators + stdlib generics — no interfaces/typeclasses/overloading yet. The compatible future path for shared behavior is trait/typeclass-style contracts (polymorphism *without* subtyping, à la Rust traits) — a v2 candidate that rides alongside user-definable generics, never class inheritance.
- **Types describe data; they do not compute** (no type-level computation).

---

## 8. Async

`async` / `await` with the JS surface (familiar, transfers everywhere). `await` explicitly marks every suspension point. Scheduling is handled at the VM level (suspension points are natural fuel-yield points).

```ascent
fix fetchUser = async fn(id: Int) -> User {
    fix response = await http.get("/users/${id}");
    return parseUser(response);
};
```

---

## 9. Error handling & diagnostics

- **Unexpected failure crashes loudly** with a precise, friendly message + location + locals (index out of bounds, division by zero, overflow). The correct first model of failure for a beginner.
- **Expected failure is data** — parsing returns `Int?`, lookups return `V?`.
- **No `try`/`catch` in v1**; exceptions-as-control-flow are a later module.

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

`import math;` — one file = one module. No default exports, re-exports, or circular imports. Explainable in two sentences.

---

## 11. The environment & UI model

A browser-based **canvas**. You open a code panel to write a program; a program can spawn new interactive panels onto the same canvas.

**Program input — `args`.** Before any UI (or even functions), a program asks for typed values with an `args` preamble — a parenthesized, typed list at the very top:

```ascent
args (age: Int, name: String)

"Hi ${name} — next year you'll be ${age + 1}"
```

- **Gathered and validated before the body runs.** The environment reads the `args` list, builds a fitting input dialog (one field per arg), collects the values, and **validates each to its declared type at the boundary** — type "abc" into an `Int` field and it re-asks, so the body never runs with a bad value (§6: external data is parsed into a declared type at the boundary). By the time the first body line executes, every `args` slot already holds a value, so the body stays fully synchronous and pure — no `await`, no effects.
- **Type drives the widget:** `String` → text field, `Int` / `Float` → number field, `Bool` → checkbox. (The CLI supplies the same values as flags / stdin instead of a modal.)
- **Not a new slot kind.** Each arg is an ordinary fixed slot whose initializer happens to be the user rather than a literal; the required annotation is honest, since there is nothing to infer from.
- **Staged path to functions.** The `args (...)` list is written in the exact `name: Type` form of a parameter list — because that is what it is. A script is the body of an implicit `main`, and `args` is its parameter list, supplied by the environment as caller. When functions arrive (§12, stage 3) this is revealed — "that `args` line was `main`'s parameters; here is `fn`" — so the chapter-one affordance *is* the function mechanism, met in stages, with nothing unlearned.
- **Graduation note.** Real-world program arguments (`argv`, `sys.argv`, `String[] args`) arrive as a raw, positional list of *strings* the program indexes and parses itself; Ascent names them and checks their types for you — the same idea with training wheels. `prompt()` (later, once functions exist) removes the wheels by handing back a raw `String` you parse yourself.

- **UI as values.** `Element<Msg>` is a stdlib tagged union (a tree of elements). No new language features are needed — `match` + unions + first-class functions are exactly the MVU basis.
- **MVU architecture.** A panel is three values: a `State`, `view : State -> Element`, and `update : State × Msg -> State`. Buttons carry **message values**, not callbacks (no `this`, no listener lifecycle). **Exhaustiveness checking becomes a UI feature** — add a button, the compiler demands you handle its message.
- **Learning ramp:** (1) `print` → console panel; (2) static UI via `show(element)`; (3) add `State` + `update` for interactivity — only two new ideas.
- **Environment affordances (cheap because state is immutable + view/update are pure):** live state inspector, time-travel history scrubber, state-preserving hot reload, multiple independent panels.
- **Deferred:** the effects model (likely async `update` + subscriptions-as-data) and the concrete widget vocabulary.

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

## 15. Open questions (the backlog, to address one by one)

1. **Effects model for UI** — async `update` + subscriptions-as-data needs a concrete design.
2. **Widget vocabulary** — the minimal `Element` set.
3. **`Ref` surface** — `get`/`set` vs a `.value` field; identity vs structural equality once `Ref` exists.
4. **v2 generics slot** — design v1's generic-consumption and `type` syntax so user-definable generics *and* trait-style shared-behavior contracts drop in *without* breaking changes. (The single most important forward-compat decision.)

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
