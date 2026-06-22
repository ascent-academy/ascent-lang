# Ascent — A Teaching Language

### Design Whitepaper · v1 (draft)

> *Ascent is a small, opinionated programming language for learning to program — designed to get beginners moving quickly and carry them smoothly up into mainstream languages, with honest, see-everything mechanics and no hidden magic along the way.*

---

## 1. Design principles

These are the rules every other decision answers to.

1. **Honesty over magic.** No hidden coercions, no silent failure states, no two-kinds-of-nothing. If something happens, it's visible.
2. **Cage the footguns at the source.** Every value is a "real" value with no weird states (no `NaN`, no silent overflow, no wild `null`). The dangerous thing is made impossible or made explicit, not documented.
3. **Regular syntax, minimal sugar.** One way to do each thing. Three deliberate exceptions: string interpolation, `else if`, and the `=>` expression-body shorthand for functions.
4. **Transfer over novelty.** Surface syntax (braces, semicolons, `return`, `await`) builds muscle memory for real languages; clean semantics build correct mental models. Where the two conflict, semantics win.
5. **Static types, low ceremony.** Types catch mistakes early; inference removes the paperwork.
6. **Errors are the product.** Compiler and runtime messages are written as explanations naming the things the learner wrote.
7. **Power is opt-in and late.** Advanced capability (references, user-defined generics) arrives as a later chapter, not a day-one tax.

---

## 2. Lexical & syntax

- **Braces** for all blocks; **no whitespace semantics**.
- **Semicolons** terminate every statement (simplest grammar; precise parser error recovery).
- **Comments:** `#` runs to end of line (whole-line or trailing); `#[ … ]#` is a delimited block comment that may sit mid-line or span lines, and nests. `//` is *not* a comment — it is whole-number division (§5).
- **Mandatory braces** on every `if` / `for` / `while`, even single-line (no dangling-else, no goto-fail class of bug).
- Expression-oriented: blocks in expression position evaluate to their last value, while function bodies use explicit `return` (a duality flagged in §15).

---

## 3 Slots (Variables)

A **slot** is a named location that holds one value. Assignment has value
semantics: `b = a` copies the value into `b`, and the two slots are independent
thereafter.

```
fix a = 10;
mut b = a;     # b holds its own 10
b = 20;        # a is unchanged
```

### Mutability is explicit

Every slot is declared with a mandatory mutability keyword: `fix` for a fixed
slot, `mut` for a mutable one. There is no default — unlike the
immutable-by-default of Rust or Swift, or the mutable-by-default of Java and C,
neither kind is the unmarked case.

```
fix name = 'Martin';   # reassignment is an error
mut age  = 5;          # age = 6 is legal
```

`fix` constrains the slot, not the value: it forbids rebinding the name, not
mutation of whatever the value internally permits. Value-level mutability is a
separate axis with its own keywords, reusing the same two words — fixed and
mutable — by design.

### Terminology

"Slot" is the precise term; "variable" is the colloquial synonym, and the two
are used interchangeably. The wrinkle worth flagging is that common usage
applies "variable" to every slot regardless of mutability, so "fixed variable"
turns up and reads as an oxymoron. This is less an error than the older, broader
sense of the word — *any named storage location*. Ascent keeps "slot" as the
mutability-neutral umbrella and treats "variable" as the loose superset, rather
than relitigating the wider world's usage.

### Rationale

**slot.** "Named storage location" is the precise definition of a variable, and
*slot* is the term already used for it in compiler and VM contexts (stack slots,
JVM local-variable slots). It carries none of the physical-object connotation of
"box," and it preserves the name / slot / value separation the rest of the
language relies on — a distinction that both the overloaded "variable" and the
reference-flavored "binding" tend to collapse.

**Explicit mutability.** Production languages pick a default and mark the
exception; Ascent marks both. The cost is one keyword per declaration. The
return — this being a teaching language — is that no slot's mutability depends on
a default the reader must recall, and every declaration is legible in isolation.

**`fix` / `mut`.** `mut` is the conventional clip of *mutable* (cf. Rust) and,
not being a word in its own right, cannot be read as anything else. `fix` clips
*fixed* — the "held in place" sense, as in the mathematician's "fix x = 5." It
was chosen over the obvious alternatives: `const` skews toward compile-time
constant, `val` names the value rather than the slot, and `final` is a full word
that breaks the three-letter symmetry with `mut`. Both keywords are three
letters with distinct initial characters, so mutability is legible at a glance
and the operands align. `vary` was dropped once "variable" became the umbrella
term — a keyword that is "variable" in miniature would blur the line it draws.

The one real collision — `fix` against "fix a bug" — is contained by convention
rather than avoided: `fix` only ever introduces a slot, and prose refers to
*creating a fixed slot*, never to *fixing* one, so the repair sense never
occupies the same role.

---

## 4. Values & types (the value universe)

### Scalars
- **`Int`** — 64-bit signed. **Traps on overflow** with a friendly message (no silent wraparound). No width/unsigned zoo in v1.
- **`Float`** — 64-bit IEEE 754. **`NaN`/`Infinity` are runtime errors**, not values, so every `Float` is a real, ordered number.
- **`Bool`** — `true` / `false`. **No truthiness**; conditions must be `Bool`.
- **`String`** — immutable Unicode sequence, written with double quotes (`"..."`) and `{expr}` interpolation; single quotes are unused. **No integer indexing** (avoids the Unicode-index bug class); `length` counts code points. **No `Char` type** — characters are length-1 strings.

### The "no information" value
- **`Done`** — the unit type, the value of statements/side-effecting calls (`print : fn(String) -> Done`).
- It has exactly one value; written `{}` (an empty block). **No `done` keyword**, so `done` stays free as a variable name.

### Absence
- **`none`** — behaves purely as an **Optional**. Lives in the type: `String?` means "String or none"; bare `String` can never be none.
- **Flow typing** narrows `T?` to `T` after a `!= none` check. **`??`** supplies defaults.
- No `undefined`, no second kind of nothing. `none` stands alone — no `Some`/`None` pairing to teach — chosen for familiarity with Python, the dominant first language.

```ascent
bind nick: String? = none;
bind shown = nick ?? "anonymous";
```

### Compound
- **`List<T>`** — literal `[1, 2, 3]`; growth gated by `bind mut`.
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

- **`if` / `else` / `else if`** are **expressions** (no separate ternary). `else if` is the only control-flow sugar.
- **`match`** — an expression, **exhaustiveness-checked**. v1 patterns are shallow: variant + field binding, literals, `_`. (No nested patterns, guards, or or-patterns in v1.) Chosen over `switch` to avoid fallthrough/`break` expectations.
- **`for x in xs`** iterates values; **`while cond { }`** for condition loops. No C-style three-part `for`.
- **Operators are words**: `and` / `or` / `not` (operate on `Bool` only — consistent with the word-first keyword set and no-truthiness).
- **`==`** is structural and same-type-only (cross-type comparison is a compile error). **`<` `>` `<=` `>=`** on `Int` / `Float` / `String`.
- **No implicit conversions** (`Int + Float` is an error; use `toFloat`). **No operator overloading.**
- **Division is split by intent.** `/` is real division on `Float` only (`Float / Float -> Float`); `//` is whole-number floor division on `Int` only (`Int // Int -> Int`). `Int / Int` is a compile error that points to `//` or `toFloat`, so the `1 / 2 == 0` surprise can never happen silently. Floor rounds toward −∞ (pairing with a future `mod`); division by zero is the loud crash of §9. Mirrors Python 3's `/` vs `//`.
- **Function bodies** take two forms: a **block body** `fn(...) -> T { ...; return e; }` with explicit `return`, or an **expression body** `fn(...) -> T => e` where `e` is a single expression — never a bare block (`=> {` is an error; use the block form for multiple statements). `=>` reads as "the result is this expression."
- **`return`** exits the enclosing function with a value. Blocks in expression position (`if`/`match` branches) yield their last value instead — the duality noted in §15.

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
    greeting:  fn(self) -> String => "Hi, {self.name}",
    withScore: fn(self, points: Int) -> Player =>
        Player{ name: self.name, score: self.score + points },
};
```

- **Fields and methods are both *members*,** declared with the same `name: …` syntax and separated by commas. (`bind` names a value inside a *scope* — top level or a function body — and never appears inside a type. The colon does subtly different work in each case: a field's right side is a *type*, a method's is an *implementation* — which mirrors the `name: value` of construction.) Method bodies use the same two forms as any function: `=> e`, or a `{ …; return e; }` block.
- **The receiver is an explicit `self`** — the one parameter that needs no annotation, because its type is fixed by the enclosing type. This keeps the mechanic visible: a method is just a function whose first argument is the receiver, the same `self` a learner later meets in Python.
- **The dot has exactly one meaning — a member of this value:** a field (`p.name`) or a method (`p.greeting()`). `x.f()` resolves to a method declared on `x`'s concrete type, or it is an error — no hidden free-function call, no dispatch, no inheritance chain.
- **Methods on a union** dispatch internally with `match self`; the field-access rule still holds, so a multi-variant value exposes methods but no direct fields:

```ascent
type Shape =
    | Circle{ radius: Float }
    | Rect{ width: Float, height: Float }
methods {
    area: fn(self) -> Float => match self {
        Circle{ radius }      -> 3.14159 * radius * radius;
        Rect{ width, height } -> width * height;
    },
};

bind a = Circle{ radius: 2.0 }.area();   # a real method on Shape
```

- **Free functions coexist** for operations not naturally "on" a type (`bind double = fn(x: Int) -> Int => x * 2`, called `double(5)`). Each operation is a method *or* a free function — decided once by whoever defines it — so there is exactly **one way to call it**. (This is precisely what UFCS gave up: it let every function be called two ways.)
- **Real method chaining** — `xs.map(double).filter(isEven)` — is genuine, not sugar over nested calls, and it is the mainstream idiom, so it transfers directly. No pipe operator is needed or provided.
- **You cannot add methods to a type you don't own** in v1; built-in types ship their own methods. Extending an existing type is a deliberate v2 feature, not an accident — and that contrast will later teach the difference between a type's own behavior and a bolted-on extension.

---

## 7. Type system

The governing move: the checker mainly answers one question — *"are these two named types the same?"*

- **Nominal typing.** A `User` is a `User` because it was declared one (simple to implement, clear errors, predictable).
- **No subtyping.** No inheritance, no implicit widening, no variance. The only crack: a non-null `T` is usable where `T?` is expected — a single hard-coded widening rule, not a system. Methods don't disturb this: `x.f()` is a nominal lookup of `f` on `x`'s concrete type — at most one match, with no overloading and no dispatch hierarchy to search.
- **Inference lives only on `bind`.** Every function signature is fully explicit — **both parameter and return types are mandatory** — so nothing about a function's type is reconstructed from its body, errors stay local and name real types, and recursion needs no special case. A binding's type is inferred from its initializer; generic *type arguments* at call sites are still inferred automatically (you never write `map<Int, Int>`). Implemented via **bidirectional type checking** (bounded, no global unification). Wrinkle: a `bind` whose initializer carries no type information (a bare `[]` or lone `none`) needs an annotation.
- **Generics are consumable, not definable** in v1 (`List<Int>`, `Map<K,V>`, stdlib `map`/`filter`). The only polymorphism is built-in operators + stdlib generics — no interfaces/typeclasses/overloading yet. The compatible future path for shared behavior is trait/typeclass-style contracts (polymorphism *without* subtyping, à la Rust traits) — a v2 candidate that rides alongside user-definable generics, never class inheritance.
- **Types describe data; they do not compute** (no type-level computation).

---

## 8. Async

`async` / `await` with the JS surface (familiar, transfers everywhere). `await` explicitly marks every suspension point. Scheduling is handled at the VM level (suspension points are natural fuel-yield points).

```ascent
bind fetchUser = async fn(id: Int) -> User {
    bind response = await http.get("/users/{id}");
    return parseUser(response);
};
```

---

## 9. Error handling

- **Unexpected failure crashes loudly** with a precise, friendly message + location + locals (index out of bounds, division by zero, overflow). The correct first model of failure for a beginner.
- **Expected failure is data** — parsing returns `Int?`, lookups return `V?`.
- **No `try`/`catch` in v1**; exceptions-as-control-flow are a later module.

---

## 10. Modules

`import math;` — one file = one module. No default exports, re-exports, or circular imports. Explainable in two sentences.

---

## 11. The environment & UI model

A browser-based **canvas**. You open a code panel to write a program; a program can spawn new interactive panels onto the same canvas.

- **UI as values.** `Element<Msg>` is a stdlib tagged union (a tree of elements). No new language features are needed — `match` + unions + first-class functions are exactly the MVU basis.
- **MVU architecture.** A panel is three values: a `State`, `view : State -> Element`, and `update : State × Msg -> State`. Buttons carry **message values**, not callbacks (no `this`, no listener lifecycle). **Exhaustiveness checking becomes a UI feature** — add a button, the compiler demands you handle its message.
- **Learning ramp:** (1) `print` → console panel; (2) static UI via `show(element)`; (3) add `State` + `update` for interactivity — only two new ideas.
- **Environment affordances (cheap because state is immutable + view/update are pure):** live state inspector, time-travel history scrubber, state-preserving hot reload, multiple independent panels.
- **Deferred:** the effects model (likely async `update` + subscriptions-as-data) and the concrete widget vocabulary.

---

## 12. Implementation

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
5. **Block value-production duality (parked).** Braces yield their last value inside `if`/`match` branches but require `return` in a function body — one syntax, two behaviors. Two candidate fixes: make the `{ }`-statement / `=>`-value split uniform (forces `if c => a else => b` and single-expression branches), or go Rust-style tail-expression everywhere (keeps brace-`if`s but makes a function's result its silent last line). Neither is foreclosed by current decisions.

---

## Appendix — a representative program

```ascent
type Shape =
    | Circle{ radius: Float }
    | Rect{ width: Float, height: Float }
methods {
    area: fn(self) -> Float => match self {     # a method, expression body
        Circle{ radius }      -> 3.14159 * radius * radius;
        Rect{ width, height } -> width * height;
    },
};

type Player = {
    name: String,
    score: Int,
} methods {
    rank:     fn(self) -> String => if self.score >= 100 { "pro" } else { "rookie" },
    describe: fn(self) -> String => "{self.name} is a {self.rank()}",
};

bind main = fn() -> Done {                       # a free function, block body
    bind shapes = [ Circle{ radius: 2.0 }, Rect{ width: 3.0, height: 4.0 } ];
    bind mut total = 0.0;
    for s in shapes {
        total = total + s.area();                # method call on a union
    }
    print("total area: {total}");

    bind ada = Player{ name: "Ada", score: 120 };
    print(ada.describe());                       # describe calls self.rank()
};
```
