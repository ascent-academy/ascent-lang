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
- **The backtick `` ` `` is reserved for tagged DSL blocks** — inline `` tag`…` `` and Markdown-style triple-fence `` tag```…``` `` (§4) — and has no other use in the language, so it never collides with strings (`"…"`) or calls.
- **The `!` sigil marks an async call:** `fetchUser!(args)` prepares an inert `Task<T>` (§8) — a bare async call without it is a compile error. The character is borrowed provisionally (it means *macro* in Rust, *assert* elsewhere) and may be swapped for another mark later; what is fixed is the concept — an async call carries a *visible* marker, never silent call-shaped syntax that secretly doesn't call.
- **Identifiers**: `[A-Za-z_][A-Za-z0-9_]*`. Keywords (`fix`, `mut`, `and`, `or`, `not`, `div`, `mod`, `args`, `try`, `orelse`, `abort`, `void`, `import`, `export`, `from`, `with`, `async`, `await`, `nursery`, `trait`, `implement`, `requires`, `Self`, and the control-flow/type words) are reserved. The last four are held ahead of the traits feature (§16) — reserved now so no program breaks when it lands, even though they are not yet usable. (`True`, `False`, `None` are *not* keywords — they are built-in constructors, below.)
- **Naming & casing.** **Uppercase (`UpperCamel`) names are exactly those a `type` introduces — the type *and* all of its constructors**, with no exceptions: `Color`/`Red`/`Green`, `Bool`/`True`/`False`, `Optional`/`None`, `Result`/`Ok`/`Err`, and the unit `Done` (a one-variant type whose sole value shares its name). **Lowercase (`lowerCamel`) names are bindings** — variables, functions, fields, parameters. The rule is bidirectional and **enforced: a binding may not begin with a capital letter**, so an initial uppercase letter *always* means "a type or constructor" and an initial lowercase letter *always* means "a binding" — no ambiguity, ever (Haskell's discipline). Numbers and strings are **lexical literals**, not identifiers, so the rule does not apply to them (`42`, `"hi"` come from the lexer, they are not names — this, not "constructors," was the right category for them). The type/constructor overlap (`Color`/`Red`, `Done`/`Done`) is harmless because the two never share a syntactic slot — a type appears only after `:` or `->`, a constructor only in value and pattern positions — so position always disambiguates, as decades of Haskell and Elm confirm. The built-in constructors `True`, `False`, `None`, `Ok`, `Err`, `Done` are **non-shadowable** — you can no more rebind `True` than redefine `42`. *Graduation note:* capitalized `True`/`False`/`None` match Python exactly, but diverge from the C family and TypeScript, which write lowercase `true`/`false` — a deliberate, named false friend, accepted because internal consistency wins here: `Bool` and `Optional` are ordinary tagged unions (`True | False`, `None | value`), so their constructors are uppercase like every other constructor rather than being special-cased into lowercase.
- **Type names use the dominant canonical spelling, not the shortest:** `Int` (over `Integer`), `Float`, `Bool` (over `Boolean`), `String` (over `Str`). The rule is "the most common real-world name" — which happens to be short for some and full for others. `Str` is rejected because `String` dominates everywhere a graduate is headed (Java, Swift, Kotlin, C#, TypeScript), while `str` denotes a *different*, advanced thing in Rust — so `Str` would be a false friend, not a tidy abbreviation.
- **Mandatory braces** on every `if` / `for` / `while`, even single-line (no dangling-else, no goto-fail class of bug). The *test* of `if` / `while` / `match` is parenthesized — `if (cond) { }` — easing the move to TypeScript and the C family; `for` takes no parens (it has no test).
- **Expression-oriented: every block yields the value of its last statement** — a branch, a loop body, a function body, and the whole program alike (one rule, no special cases). The trailing semicolon is optional exactly as a list's trailing comma is — `{ a; b; c }` ≡ `{ a; b; c; }` — never load-bearing for the value. A last statement that isn't a value (a declaration, an assignment) yields `Done`.
- **Discarding a value is explicit — `void`.** Because a block's value is its *last* statement (above), a *non-final* statement's value is thrown away — and silently dropping a real value is a classic bug (calling `xs.sort()` for effect, forgetting it returns a *new* list and changes nothing). So a non-final statement whose value is **not** `Done` must explicitly discard it with **`void`** (`void validate(input);`), or it is a compile error. `void expr` evaluates `expr` and drops its result — exactly TypeScript's `void expr`, so it transfers as the same "intentionally ignore this" marker rather than a false friend. Nothing else needs it: a `Done`-valued statement (an effectful `print`, a loop) has nothing to drop; a final statement's value is used; and a value bound (`fix`/`mut`), passed to a function, or used within an expression is consumed, not dropped — so the rule fires *only* on a bare non-`Done` value in non-final position, which is exactly the silent-no-op bug. An `if`/`match` used purely for effect whose branches yield a non-`Done` value takes the `void` on the whole expression (`void if (c) { a() } else { b() }`), since it is one expression in statement position. Ascent has **no `void` *type*** — a function returning nothing returns `Done` (§4); `void` is exclusively this discard keyword, so a C/Java arrival should not expect it as a return type.

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
- **The slot is the only mutable thing in the language.** No *value* ever changes in place — not a list, not a record, nothing. "Mutating" a structure means computing a new value and rebinding a `mut` slot (`xs = xs.append(4)`); in-place mutation of structures does not exist (§6), so there is one uniform story — immutable values everywhere, change confined to the single visible act of rebinding a `mut` slot. Cheap in practice via persistent data structures (§12); genuinely shared mutable state is the explicit `Ref<T>` (below).
- **`fix` constrains the slot** (rebinding the name), not the deep mutability of the value — that is a separate axis the same `fix`/`mut` pair will extend to later, by design (one concept, not two).
- Graduation: this is `let` / `let mut` in Rust, `val` / `var` in Swift and Kotlin, `const` / `let` in JavaScript — note `let` flips between *immutable* (Rust) and *mutable* (JS), a clash `fix`/`mut` sidesteps by belonging to no one.

---

## 4. Values & types (the value universe)

### Scalars
- **`Int`** — 64-bit signed, written `42`. **Traps on overflow** with a friendly message (no silent wraparound); promotes to `Float` in mixed arithmetic (§5). No width/unsigned zoo in v1.
- **`Float`** — 64-bit IEEE 754, written `3.14` (a digit is required on *both* sides of the point — no `3.` or `.5`; exponents and digit separators are deferred). **`NaN`/`Infinity` are runtime errors**, not values, so every `Float` is a real, ordered number.
- **`Bool`** — `True` / `False`. **No truthiness**; conditions must be `Bool`.
- **`String`** — immutable Unicode sequence, written with double quotes (`"..."`) and `${expr}` interpolation (`"Hi ${name}"`); single quotes are unused. Interpolation is always on but triggers only on `${`, so literal braces need no escaping (`"{}"` is two characters) and a lone `$` is literal; escape a literal `${` as `\${`. **No integer indexing** (avoids the Unicode-index bug class); `length` counts code points. **No `Char` type** — characters are length-1 strings.
- **What can go in a `${}` hole — the hole is a `Display`-bounded position.** Interpolation must turn the hole's value into a `String`, so the hole requires a value that *has* a canonical string form. **The built-in scalars have one** — `Int` → its decimal digits, `Float` → digits with the decimal point always shown (`3.0`, never collapsed to `3`, keeping the Float visible), `Bool` → `"True"` / `"False"` (its constructor spelling — what you write is what you get), `String` → itself — so `"count: ${n}"` just works. **Structured types (records, unions, collections) have *no* canonical string form**, so `"${user}"` is a **compile error** directing you to interpolate a scalar field (`"${user.name}"`) or call an explicit conversion you wrote (`"${money.toStr()}"`). There is deliberately **no universal `toString`**: that would demand a capability on *every* type (an `Any`-supertype by another name, §6) and would produce dishonest default output — a record dumping its fields, leaking data, meaning nothing. Formally, the hole's type is **`T` where `T: Display`** (the "has a canonical string form" capability). `Display` is a trait (§16) and does not exist yet, so **today the bound is hard-coded** — only the built-in scalars satisfy it, checked by the compiler — exactly the situation of `sort` (a capability hard-coded to built-in types until `Comparable` lands, §15). When traits arrive the hole becomes a genuine `T: Display` position: scalars ship with `Display`, and a structured type opts into direct interpolation by implementing it, so `"${money}"` works once `Money: Display` — with no change to what any existing program means. Interpolation is thus where the `Display` trait is *discovered from evidence* (§15).
- **No arithmetic operator works on strings — string operations are named methods.** `+` stays purely numeric: overloading it for concatenation makes it non-commutative and arithmetic-shaped when it is neither, and it is the doorway to JavaScript's coercion disaster (`1 + "2"` → `"12"`), which Ascent's no-implicit-coercion stance already shut. And `"hi" * 5`-style extensions are **puns, not meanings** — `*` does not *mean* "repeat," it just loosely analogizes to repeated addition, so a reader must *decode* it; worse, the puns do not generalize (why `*` but not `-` for "remove"?), which is exactly the arbitrariness the language avoids. So: **building** a string is `${}` interpolation (`"Hello, ${name}!"` — always-on, so a concatenation operator is rarely even needed) or `.concat` / `xs.join(sep)` for assembling parts; **repetition, padding, casing, trimming, and the rest are self-naming methods** (`.repeat(5)`, `.padLeft(n)`, `.trim()`), each of which reads as what it does rather than as an operator a learner must memorize. (The *one* defensible operator, if expression-position concatenation ever proves common, is `++` — a dedicated combine operator à la Haskell/Elm, distinct from arithmetic `+` and shared with lists, not a pun — but it is deferred until a real need appears; methods and interpolation cover the cases today.)
- **Multiline strings use `"""..."""`.** A plain `"..."` is **strictly single-line** — a newline may not appear inside it — so the commonest string typo, a missing closing quote, is caught *at the end of its line* ("you opened a quote here and never closed it") rather than the lexer swallowing the rest of the file into one string. Multiline content uses a distinct triple-quote delimiter (Python / Swift / Kotlin — transferable), and the design cages the notorious indentation footgun: **the closing `"""`'s column sets the margin, and that much leading whitespace is stripped from every line** (Swift's rule), so the string sits at natural source indentation without that indentation leaking into the value; and a newline immediately after the opening `"""` is dropped, so content starts on the next line. `${}` interpolation is **always-on here too** — one uniform string model, single- and multi-line alike.

  ```ascent
  fix poem = """
      Roses are ${color},
      Ascent is small.
      """      # closing """ column sets the margin → "Roses are red,\nAscent is small."
  ```
- **Compile-time-validated data literals — the fenced-backtick DSL family.** Embedded foreign data (JSON now; HTML, regex, … as they are blessed) is written as a **tagged backtick block**, not a string and not a call — because it *is* a different thing (a span of foreign syntax the compiler validates), and it should look like one. Inline uses single backticks, blocks use a Markdown-style triple-backtick fence with the tag:

  ````ascent
  fix data = json`{ "hello": "world" }`          # inline

  fix page = json```
  { "hello": "world", "items": [1, 2, 3] }
  ```
  ````

  The backtick is unused elsewhere in Ascent, rare inside DSL payloads, and visually distinct from `"` strings and from `()` calls; the leading tag names the DSL; and the triple-fence is the universally-recognized "here is a block of «language»" from Markdown, which web-bound learners already read fluently. **Payloads that themselves contain backticks escalate the fence** (a longer fence wraps content holding a shorter one — Markdown's own rule, inherited wholesale), so the end is always findable. The compiler **validates the block at authoring time** — malformed JSON is a *compile* error, position-accurate and pointing inside the block. This is **not a macro system**: the tag set is a **closed, compiler-curated** collection chosen by the language author, and it is **off by default — a file switches a DSL on by importing it** (`import json`), so a file with no DSL imports has zero DSL surface and the import documents exactly which formats are live. No third-party code ever runs in the compiler; adding a DSL is a compiler change, made with the language designer's quality bar.
- **A DSL block is syntax-checked at compile time, *shape*-checked at runtime.** `json`…`` produces a runtime **`Json` value** — the nominal tagged union (object / array / string / number / bool / null), navigated by `match` — **not** a structural type inferred from the block's shape. Inferring a shape-type (`{ name: String, age: Int }`) would reintroduce the structural typing §7 shut out, so it is refused. To cross from generic `Json` to one of *your* nominal types you **decode**: `data.decode(User)` returns `User orelse DecodeError`, a runtime, fallible boundary that teaches parse-at-the-edge. So the two failures land honestly where each can — **compile time checks the syntax, runtime `decode` checks the shape against your type.** Each DSL is this pairing: a compile-time *validator* plus a runtime *library* that supplies the value's type and operations.
- **`html` is deferred — it is *your JSX*, not a quick win.** Producing an `Element` (§11) from an `html` block is *authoring UI*, and it must answer interpolation, message values (buttons carry messages, not callbacks, §11), dynamic children, and composability — the very problems JSX exists to solve. So it belongs with the UI-authoring design (§11/§15), not shipped as a casual literal; early lessons build UI from `Element` **values** first, and the `html` block arrives once the UI story is mature. **DSL interpolation in general** (`${}` holes inside a block) is its own open question (§15): it interacts with compile-time validation (the template is checked, but the filled result depends on runtime values) and with injection safety (a naive splice into `html`/`sql` is the XSS/injection class), so holes must be *typed and DSL-aware* — auto-escaping per format — rather than plain string splicing. The fenced-backtick shape is **reserved now** for the whole family (§2).

### The "no information" value
- **`Done`** — the unit type, the value of statements/side-effecting calls (`print : fn(String) -> Done`).
- It has exactly one value; written `{}` (an empty block). **No `done` keyword**, so `done` stays free as a variable name.

### Absence
- **`None`** — the one absent value. **`T?` is sugar for `Optional<T>`** — an ordinary union (`None` or a value), not a special form; `String?` means "String or None," and a bare `String` can never be None. The recovery tools live in §9 (`??` to default, `try` to propagate, `match` to inspect).
- **Flow typing** narrows `T?` to `T` after a `!= None` check. **`??`** supplies defaults — on `Optional` only (a `Result`'s error must be acknowledged, not silently defaulted; §9).
- No `undefined`, no second kind of nothing. `None` stands alone — presence is just the bare value, absence is `None`, with no `Some(...)` wrapper to teach — and it capitalizes to match Python's `None`, the dominant first language.

```ascent
fix nick: String? = None;
fix shown = nick ?? "anonymous";
```

### Compound
- **`List<T>`** — homogeneous: one element type `T`, every element a `T` (this is what makes `for x in xs` give each `x` the same type and `.map`/`.filter` honest). A literal `[1, 2, 3]` infers `T` as the **least common type of its elements**: all `Int` → `List<Int>`; all the same type `T` → `List<T>`; an `Int`/`Float` mix → `List<Float>` (the `Int`s promote — the same one-way rule as §5, so `[30, 30.5, 31]` is `List<Float>`, but `[30, 31]` stays `List<Int>`). Elements with no common type (`[1, "x", True]`) are a compile error — to mix shapes, name them as a union and use `List<ThatUnion>`. The "least common type" relation is exactly as wide as value promotion and no wider (just `Int`→`Float`); it is *not* subtyping (§7). The empty `[]` has no elements to infer from, so it takes its type from context (`fix xs: List<Int> = []`); a bare `fix xs = []` is the annotation-required error (§7). Growth is gated by a `mut` slot.
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
- **`while (cond) { }`** for condition loops. **`for x in xs`** iterates values and takes **no** parens — it has no test, and parenthesizing it would mimic TypeScript's *key*-iterating `for…in`, the very false friend the `in`-for-values choice avoids. No C-style three-part `for`. **Both are statements that yield `Done`** — a loop has no single meaningful result (an empty collection, or a `while` that runs zero times, has no last value to give), while a provably-infinite `while (True)` is typed `Never` (§7). Producing a value *from* a sequence is the collection API's job — `reduce`, `find` (→ `T?`), `map`, `filter` — never loop-return; this keeps the block-value rule (§2) special-case-free, since a loop body's last statement is an effect yielding `Done`.
- **Operators are words**: `and` / `or` / `not` (operate on `Bool` only — consistent with the word-first keyword set and no-truthiness).
- **`==`** is structural; operands must share a type, except that `Int` and `Float` compare as numbers (`1 == 1.0` is `True`, via the one-way promotion below). Other cross-type comparison (e.g. `Int` vs `String`) is a compile error. **`<` `>` `<=` `>=`** work on `Int` / `Float` / `String`, with the same `Int`/`Float` mixing allowed.
- **Numbers promote one way — `Int` → `Float`, never back.** When an `Int` meets a `Float` in arithmetic or comparison, the `Int` becomes a `Float` (value-preserving). So `+`, `-`, `*` yield an `Int` only when *every* operand is an `Int`, and a `Float` the moment any operand is a `Float`. A `Float` is never silently narrowed to an `Int` — that needs an explicit `.toInt()` (§6). No other implicit conversions, and no operator overloading.
- **Division & modulo.** `/` **always yields a `Float`**, whatever the operands — `10 / 2` is `5.0`, `7 / 2` is `3.5` — so the silent integer-truncation bug simply can't occur. **`div`** is whole-number floor division on `Int` operands only (`7 div 2 -> 3`); using it on a `Float` is an error, and division by zero is the loud crash of §9. Floor rounds toward −∞. **`mod`** is its partner — floored modulo, `Int`-only, with the same Float-is-an-error and divide-by-zero-crashes rules — so that the identity `(a div b) * b + (a mod b) == a` always holds. Because `div` floors, `mod` follows the *mathematical / Python* convention where the result takes the **sign of the divisor**: `-7 mod 3` is `2`, not `-1`. Both are words, not `//` / `%`: `//` collides — comment in the C family, floor division in Python (§2). Graduation notes: `/` is real division in Python too, while C/Java/JS truncate `int/int` (needing a `Float` operand or `Math.floor` to match); and C/Java/JS/Rust `%` is *remainder* (sign of the **dividend**, `-7 % 3 == -1`), which differs from Ascent's `mod` on negative operands — a silent false friend, named here rather than left to ambush.
- **Exponentiation `**`.** `a ** b` raises `a` to the power `b`, and it follows the promotion of `*` (**not** the always-`Float` of `/`): **`Int ** Int` is an `Int`** (`2 ** 10` is `1024`, exact — forcing `1024.0` would discard a clean integer for no honesty gain), and if either operand is a `Float` the result is `Float` (`2.0 ** 3`, `2 ** 0.5` → `Float`). The one wrinkle is a **negative integer exponent**: `2 ** -1` is `0.5`, not an `Int` — and since the exponent may be a runtime value (`2 ** n`), the result type cannot hinge on its sign. So `Int ** Int` always types as `Int`, and a negative exponent is a **loud crash** (bug tier, §9) whose message says to use a `Float` base (`2.0 ** -1` → `0.5`); this mirrors how `div` rejects a `Float` — the operation stays exact-or-errors rather than silently truncating `2 ** -1` to `0`. Overflow (`2 ** 100`) is the normal `Int`-overflow trap (§4). Spelled `**` (Python / Ruby / JS), not `^`, which reads as *xor* to most. It is **right-associative** (`2 ** 3 ** 2` is `2 ** 9` = `512`) and **binds tighter than unary minus** (`-2 ** 2` is `-(2 ** 2)` = `-4`, the math convention) — though its right operand still admits a leading unary minus, so `2 ** -1` parses as `2 ** (-1)`.
- **Operator precedence**, loosest to tightest: `or` · `and` · `not` · comparisons (`== != < <= > >=`, non-associative — no chaining) · `+ -` · `* / div mod` · unary `-` · `**` (right-associative, tighter than unary minus) · atoms (literals, identifiers, parenthesized expressions). Binary arithmetic is left-associative. Follows Python in one respect: `not` binds looser than comparison, so `not a == b` parses as `not (a == b)`. The expression parser is Pratt-style (§12).
- **Function bodies are just blocks.** `fn(...) -> T { … }` yields the value of its last statement (§2) — no `return` needed. The single-expression form `fn(...) -> T => e` is sugar for `{ e }`; `=>` reads as "the result is this expression." Use whichever fits — they mean the same thing (so `=> {` is merely redundant, a style nit, not an error).
- **`return`** is an **early exit** from the enclosing function, used only to leave *before* the last statement. Reaching the end is the normal path, and the body's value is that last statement (§2).
- **Closures capture by value.** A function may use names from the scope where it was defined (`fn(x) -> Int => x + base` uses `base`), and it **snapshots their values at the moment it is created** — later changes to the outer slot do not affect it. This is not an arbitrary pick: it is value semantics (§3) extended to closures, so the whole language obeys one rule — names hold values, and what a closure remembers is a value too, never a live reference to someone else's slot. The famous loop footgun therefore cannot occur — building `fn() => i` three times in a `while` loop captures `0`, `1`, `2` (the snapshots), not three views of a single mutated `i` that all read `3` (the capture-by-reference result JS shipped, then patched with per-iteration `let`). A closure captures **only the outer names it actually uses**, keeping it cheap and its dependencies legible. The rare case where a closure *should* track later mutation — shared evolving state — is exactly `Ref<T>` (§4): captured by value like everything else, but it *holds* a shared slot, so the sharing is opt-in and visible in the type rather than the silent default of every closure.
- **Recursion — a `fix` binding is in scope within its own initializer.** Functions are ordinary values, made *only* by `fix f = fn(...)` — there is no separate `fn name(...)` declaration form. That creates a chicken-and-egg with recursion: `fix f = fn(n: Int) -> Int => ... f(n - 1) ...` references `f` while `f`'s slot is still being computed. The resolution is a *recursive `let`*: **`fix name = <init>` binds `name` in scope for `<init>`**. When `<init>` is a lambda, self-reference works — the closure captures the *slot* `f`, and because a function's **body runs at call time, not definition time**, the slot is filled by the time `f` calls itself. *Eager* self-reference, where the initializer runs immediately (`fix x = x + 1`), is instead a caught **"used before initialized"** error — there the slot really is read before it holds a value. (Capture-by-value is untouched: it governs the *outer* names a closure closes over; a binding's reference to *its own* name is self-reference, resolved to the slot, not a snapshot.)
- **Mutual recursion is deferred.** Value bindings are otherwise *sequential* — each `fix` sees only what precedes it — so two functions that call each other cannot see each other under plain `fix`: the reference is circular, and no ordering resolves it. Self-reference is handled (above); mutual recursion is **not yet**, and will be served — when a real need appears — by an explicit grouping form (a `rec { … }` block whose bindings are all mutually visible, the honest `let rec … and …`), **never** by silently hoisting lambda-valued bindings, which would make a `fix`'s scope depend invisibly on whether its neighbours happen to be lambdas — the hidden magic the language rejects. Until that form lands, mutual recursion is simply unavailable, which is acceptable because it is rare and never appears in early lessons.

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
- **Guarded construction — the `make { }` section makes invalid states unrepresentable.** A type may carry a **`make { }` section** (a sibling of `methods { }`) holding one or more **named validating constructors**, each typically returning `T orelse E`:

  ```ascent
  type HexColor = HexColor{ value: String }
    make {
        fromString: fn(s: String) -> HexColor orelse HexError {
            # validate "#RRGGBB"...
            HexColor{ value: s }        # raw constructor — reachable ONLY inside make / methods
        },
        fromRgb: fn(r: Int, g: Int, b: Int) -> HexColor orelse HexError {
            # clamp / validate, then format
            HexColor{ value: hex }
        },
    }
  ```

  Called `HexColor.fromString("#ff0000")` / `HexColor.fromRgb(255, 0, 0)` (the dot is namespace-qualified access, §10 — one static target, no dispatch), each returning a `Result` that composes with `try` / `match` like any fallible function (§9). The rules, all falling out of pieces already present:
  - **A `make` section seals the raw constructor.** When one is present, the raw `HexColor{ value: ... }` build form is usable **only inside the type's own body** (`make` and `methods`); outside, the only way to build one is a named constructor — so *every* `HexColor` that exists passed validation. A type with **no** `make` section is built freely as before (`Point{ x: 1, y: 2 }` anywhere) — the common case stays ceremony-free, and the *presence* of `make` is the visible, opt-in signal that the type guards itself. This is OOP's private-constructor-plus-factory, but **intrinsic to the type, not gated by a module** — drop the lines anywhere and the invariant holds, because the seal travels with the type, not its file.
  - **The seal is on *construction*, not *reading*.** `HexColor{ value }` in **pattern** position (destructuring, `match`) stays open everywhere — reading a validated value is always safe; only `HexColor{ value: x }` in **expression** position (building) is sealed. That is a sharper line than OOP's private constructor, which usually blocks reading too.
  - **`with` is sealed too, for guarded types.** Since `c with { value = "zzz" }` would forge an invalid value bypassing `make`, the `with`-update form is likewise restricted to the type's body when a `make` section is present; a guarded type exposes its *updates* as named constructors or methods returning `T orelse E` (e.g. `c.withValue(...)`), so there is no raw path — fresh or update — to an unvalidated value. (An unguarded type keeps free `with`.)
  - **Convention, not rule:** name constructors `from…` (`fromString`, `fromRgb`, `fromHsl`) — it reads as "make one *from* these inputs" — with `parse` / `make` for the single-constructor case. Encouraged for recognizability, not enforced.
- **Why lists infer their type but records don't.** `[1, 2, 3]` infers `List<Int>` because a list has one degree of freedom — the *element type* — while its structure (a sequence) is fixed by `List`. A record literal `{ name: "Martin", age: 21 }` would instead have to invent a whole *shape* (field names, field types, the fact that exactly these fields travel together) — conjuring a new type from a value. Allowing that means **structural typing** (a type defined by its shape, e.g. `Object<{name: String, age: Int}>`) — a second type system beside the nominal `type`s (§7), and it reopens what construction closed: `{ nmae: "Martin" }` would be a valid value of a *different* inferred type rather than a caught typo. So the line is **containers infer their contents; concepts get named.** You write `type Person = {...}` once; then `Person{...}` is field-checked, inferred everywhere (`fix p = Person{...}` needs no annotation), and can carry methods. Naming the shape is the modeling lesson, not ceremony.
- **Unions are named and tagged — no anonymous `Int | String`.** A type that is "one of several shapes" is a concept, so it is named with tagged variants (`type Token = Number{...} | Word{...}`), never written inline as a bare structural union. This is the record rule in sum-type form: an anonymous `Int | String` would force exactly what tagged-nominal avoids — **runtime type interrogation** (the only way to use such a value is to ask "Int or String?", i.e. carry reflective type info on bare values), **structural typing** (a type defined by its member set rather than a declared name — the door §7 already shut for records), and a **flow-narrowing sublanguage** (TypeScript-style `typeof` analysis, with its forgets-across-calls edge cases). A tagged value instead *announces* its case, so you `match` the tag it already carries — no reflection, no narrowing, no un-named sprawl. Closed enums (`type Size = Small | Medium | Large`) and payload unions (`Shape`) are both fine; only the *anonymous, untagged* union is refused. The cost is deliberate: combining error types means declaring `type AppError = Read{...} | Parse{...}` rather than writing `ReadError | ParseError` inline (§9) — the right tax for a type system with no runtime interrogation.
- **A constructor is named-field syntax, not a first-class function** (a plain function is positional; named construction is not). To pass construction where a function is expected, write a lambda — `fn(t: String) -> Msg => EditDraft{ text: t }`. Turning a constructor into a function directly, via placeholder sections (`EditDraft{ text: _ }`), is a v2 candidate (§14), not a v1 feature.
- **Update with `with { PATH = value }` — one form for every shape.** A new value derived from an existing one, with some positions replaced, is written `base with { path = value, ... }`. A **path** is a chain of steps — a `.field` step or an `[index]` step — freely mixed: it is exactly the *access* expression you would write to read that position, minus its root. So the update mirrors the read:

  ```ascent
  user  with { name = "new" }                       # a field-step
  xs    with { [3] = 42 }                            # an index-step
  grid  with { [2][5] = 99 }                         # two index-steps (a 2-D list)
  model with { users[3].address.city = "Prague" }    # mixed steps
  model with { count = it + 1 }                      # `it` is the old value at the path
  order with { total = it * 1.2, paid = True }       # several updates at once
  ```

  This is *one* construct across records, lists, nested lists, and any mix, because a path is nothing more than the navigation grammar the language already uses for reading — there is nothing new to learn, the update path *is* the read path. The rules:
  - **`=`, not `:`.** Construction (`User{ name: "x" }`) uses `:` and *builds* a value; update uses `=` and *assigns into a copy* — so the separator alone tells you which operation you are reading. `=` also matches the `path = value` assignment every mainstream language writes (easing graduation — `with` merely makes it return a new copy instead of mutating in place), and it echoes the `=` of `fix`/`mut` bindings, while equality stays `==`, so there is no clash.
  - **`it`** names the old value *at that path* (scoped per-entry in a multi-update), giving function-style updates (`count = it + 1`) without repeating the path.
  - **Paths navigate existing structure and never create it** — records cannot grow, and a missing list index is a bug: an out-of-range index anywhere along a path **crashes** (bug tier, §9), consistent with reading `xs[i]`. Growing a list (append / insert) is a *returning method* (`append`, `insert`), not `with`, since there is no existing position to name.
  - The right-hand `{ … }` is **not** an anonymous record (those do not exist — above); it is update syntax bound to the base's type, whose fields and paths are checked against that type, so typos and wrong paths are caught.

  This **replaces the old `{ ...base, field }` spread**: since records are nominal, the spread's only real job was single-base update, which `with` now does across every shape — single field, deep field, index, 2-D, mixed — with assignment notation that transfers. There is no separate list-vs-record update form; the same `with { PATH = value }` covers both, the path's steps saying which.
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
- **The receiver is an explicit `self`** — the one parameter that needs no *type* annotation, because its type is fixed by the enclosing type. This keeps the mechanic visible: a method is just a function whose first argument is the receiver, the same `self` a learner later meets in Python.
- **`self` is always read-only — there is no in-place mutation of structures.** A method only ever *reads* its receiver and returns a value; there is no `mut self`, no `xs.append(x)`, no `xs.sort()`. This is the crowning simplification of value semantics (§3): **the only mutable thing in the whole language is the slot.** A *value* — a list, a record, any structure — can never change; to "change" one you compute a new value and rebind a `mut` slot:

  ```ascent
  mut xs = [1, 2, 3];
  xs = xs.append(4);        # rebind the slot with a new list (append returns a copy)
  xs = xs.sort();           # a new sorted list, rebound
  ```

  So collection methods come in exactly one flavour — they **return** new values, and they use **plain base-form verbs**: `sort`, `reverse`, `append`, `insert`, `map`, `filter`. There is no `-ed` participle convention (`sorted`, `appended`): the participle only ever existed to distinguish a returning method from its *mutating twin*, and with mutation gone there is no twin — so "returns a copy" is the unmarked universal default, and marking it on every name would be noise. `[1, 2, 3].append(4)` simply works — it returns a new list. Because `xs.sort()` now looks identical to the in-place call a Python/JS graduate reflexively writes, the false-friend warning moves from the method *name* to the discard rule: a bare `xs.sort();` is a compile error (§2, `void`) whose message names the model — *"collection methods return a new collection and never mutate; write `xs = xs.sort()`, or discard with `void`"* — teaching the immutable-returns model once, at the point of confusion. (This deletes an entire mechanism — receiver-mutability, "which methods mutate," the mutating/returning naming split — and leaves one uniform story.)
- **Everything is immutable; the slot carries all change.** Because no value ever mutates, *every* type is immutable by construction — `Int`, `String`, a list, a `Money` you define — with no keyword, annotation, or per-type opt-in (the "frozen type" concept reference-semantics languages need is simply absent here). Two consequences: (1) genuinely *shared* mutable state is the explicit `Ref<T>` escape (§4) — a value that *holds* a shared slot, its sharing visible in the type; and (2) the efficiency of rebind-only rests on **persistent data structures** (§12) — a "new" list from `append` shares almost all of its structure with the old one (O(log n), not a full copy), so building a collection by rebinding in a loop stays fast. This is the proven Clojure / Elm model, and Elm is precisely your React on-ramp. A single quarantined *builder* for genuine hot loops is a possible later escape hatch (§15), never something a beginner meets.
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
- **Inference lives only on slots.** Every function signature is fully explicit — **both parameter and return types are mandatory** — so nothing about a function's type is reconstructed from its body, errors stay local and name real types, and recursion needs no special case. A slot's type is inferred from its initializer; generic *type arguments* at call sites are still inferred automatically (you never write `map<Int, Int>`). Implemented via **bidirectional type checking** (bounded, no global unification). Wrinkle: a slot whose initializer carries no type information (a bare `[]` or lone `None`) needs an annotation.
- **Generics are consumable, not definable** in v1 (`List<Int>`, `Map<K,V>`, stdlib `map`/`filter`). The only polymorphism is built-in operators + stdlib generics — no interfaces/typeclasses/overloading yet. The compatible future path for shared behavior is trait/typeclass-style contracts (polymorphism *without* subtyping, à la Rust traits) — a v2 candidate that rides alongside user-definable generics, never class inheritance.
- **Types describe data; they do not compute** (no type-level computation).

---

## 8. Async & concurrency

**Colored `async` / `await` — the convergent mainstream surface.** An `async` function is marked at its definition, and async-ness *propagates*: a function that `await`s is itself `async`, and its caller awaits its result. This is deliberately the **colored** model that JS, TypeScript, Python, Rust, and Swift all share — not a "colorless" scheme — because the color is *true, transferable knowledge*: a graduate meets exactly this everywhere. I/O is async, with **one** version of each operation (no `readLine` / `readLineSync` pair — pretending I/O is instant is the lie).

```ascent
fix fetchUser = async fn(id: Int) -> User {
    fix response = await httpGet!("/users/${id}");
    parseUser(response)
}
```

**An async function is not called — it is *prepared into a task*.** This is the honest core, and the place every mainstream language fudges. Calling a normal function runs its body and returns its result; an `async` function can't do that — its body suspends partway, so "call it and get the `User`" is impossible. What you actually get is a **`Task<User>`**: the work, with its arguments bound, *not yet running*. Python hides this behind ordinary call syntax (`fetchUser(id)` secretly returns an un-run coroutine — call-shaped syntax that doesn't call); Ascent makes it **visible with a sigil**:

```ascent
fix userTask = fetchUser!(id);   # Task<User> — args bound, body NOT run, nothing happening yet
```

`fetchUser!(id)` *prepares* a task; it does not start it. **A bare async call `fetchUser(id)` (no `!`) is a compile error** — there is no "just call it," because calling-and-running is not something an async function can do. The `!` is the enforced, language-level form of a convention working programmers already invent by hand: the `…Async` suffix they append to *name* async calls at the call site (`fetchUserAsync`). Ascent turns that habit into real, checked semantics you cannot forget or misspell. (The `!` character is borrowed for now — it reads as "macro" in Rust and "assert" elsewhere — and may be swapped later; what is fixed is the *concept*: an async call is marked, and the mark yields an inert task.)

**A task is an inert, first-class value.** Because `fetchUser!(id)` runs nothing, the resulting `Task` is safe to hold, store, and pass around — it is a *description* of work, not running work. This is the distinction that matters: a **floating task** (running work with no parent) is forbidden, but an **inert task value** is fine, because nothing is happening yet. Tasks are ordinary values until something *starts* them — and starting is a controlled operation (see *Concurrency*, below).

**`await` takes a task, and starts-and-waits.** One rule: `await` consumes a `Task<T>`, starts the work, suspends until it settles, and yields the `T`. There is no auto-coercion and no hidden preparation — the `!` that made the task is always visible:

```ascent
fix user = await fetchUser!(id);   # prepare the task (!), then start-and-wait (await)

# the same thing, in two steps:
fix userTask = fetchUser!(id);     # inert Task<User>
fix user     = await userTask;     # start + wait
```

Both forms are one operation; `!` appears in both because a task is the only thing `await` accepts, and `!` is the only thing that makes one.

**What `await` *means* — the teaching line, because the usual one is wrong.** `await` does **not** mean "this takes a long time" (a 30-second loop takes long and is never awaited). It marks where **your program is not the one doing the work**: it has handed a job to something slower than the CPU — the disk, the network, another machine — and is *waiting* on that, idle, not computing. `await` is the visible **edge in time** between your program and the slow outside world — the same boundary as `args` (input *before* the run) and effects (§11), now *during* it. You `await` what you **delegate**, never what you **compute**. (Even in a one-off script with no other work to overlap, `await` still marks the honest pause; overlapping others' work is a bonus when there are others, not the reason.)

**`await` and `try` compose orthogonally** (§9): they answer different questions — `await`, "*when* is the value ready?"; `try`, "*what if* it failed?". A read that is both slow and fallible stacks them, inside-out in the real order of events:

```ascent
fix lines = try await readLines!(path);   # wait for the disk, THEN handle failure
```

`await` resolves the timing (suspend until the read settles); the settled value is an ordinary `Result`, so `try` then unwraps-or-propagates it. `await try` is therefore not a valid order — there is no `Result` to `try` until `await` has produced one. After the `await` the result is a normal `Result`, so the whole §9 toolkit applies: `match (await readLines!(path))`, or `(await readLines!(path)).orAbort()` for the script case.

**Concurrency is *structured*: the nursery.** A task may be *started* only inside a **nursery** — a structured scope that owns a set of running child tasks. There is no free "start a task"; starting exists solely as a method on a nursery, so a running task can never be orphaned. This is structured concurrency (Swift / Kotlin / Trio): it abolishes the four unstructured-concurrency hells — orphans that outlive their creator, errors dropped because no one is left to catch them, zombie tasks no one cancels, floating fire-and-forget work — by giving every *running* task a parent, lexically, the way a `{ }` block owns its slots ("the *go* statement considered harmful").

```ascent
nursery n {
    n.start(fetchUser!(id));    # start an inert task into the nursery n
    n.start(fetchPosts!(id));
}   # the block does NOT close until BOTH children have finished
```

**A nursery is the owner-node of its children — a stack frame for concurrency.** Just as a call frame owns its locals and is where `return` and errors land, a nursery owns its child tasks and is where joining, failure, and cancellation land. Its **lifecycle** has four phases: *open* (the scope comes into being, owning an empty child set), *populate* (the body runs and may `start` children — dynamically, in loops, conditionally), *join* (at the body's end the nursery does **not** close; it waits until every child has finished), *close* (all children done; control proceeds; the reference is now dead — starting into it afterward is an error). `n` is a first-class `Nursery` value, and `start` is an ordinary method on it (the dot means what it always means, §6) — no magic `self`, and no free spawning — starting is always a nursery method.

**Its responsibilities are exactly three — and result-collection is pointedly not one:**
1. **Wait for all children** (the join) — so when a nursery-using function returns, nothing is still running in the background (the black-box guarantee).
2. **Propagate failure** — a child's failure cancels its siblings, then re-raises in the parent as an ordinary `orelse` / `Result` (§9). The nursery is the *join point for failures*, the concurrent twin of errors propagating up a call stack.
3. **Own cancellation** — because it knows all its children, it is the thing that *can* cancel them (on sibling failure, or from an enclosing timeout / parent cancel).

Because result-collection is deliberately **not** a responsibility, a bare nursery does not "return" values — its children self-handle (write a response, send a result onward). Collecting and shaping results is the job of *combinators* layered on top.

**A nursery is a value, so it can be passed around.** The block *bounds the lifetime*; it does not restrict *who* may call `start`. Any code holding `n` — including a function you hand it to — may start children into it, and those children are still bound by the block's lifetime. This is the escape hatch (a longer-lived helper spawning into a caller's nursery) and it is what enables dynamic spawning (a server accept loop starting a task per connection). It stays safe because passing a `Nursery` is *visible* at the call site, and the lifetime guarantee holds no matter who spawned.

**One primitive, all combinators — the key result.** The nursery has exactly **one** error policy (fail-fast: a child's failure cancels the rest). Every *other* policy is achieved not by a different nursery but by **transforming the tasks before the nursery sees them**, or by reacting differently to their completions. Concretely, a nursery exposing { `start`, per-child *completion-with-result* one at a time, `cancel`, and the lifetime guarantee } is a **complete** primitive — every combinator is a library function that starts tasks and loops over completions with a different reaction:
- `all` — collect results; on the first `Err`, cancel the rest and propagate (fail-fast).
- `gather` — wrap each task so its error becomes a *value* (`Result`); now nothing "fails," so the nursery cancels nothing and every outcome is collected (Ok and Err side by side).
- `race` — take the first completion, cancel the rest.
- `any` — first *success* wins; failures ignored unless all fail.

These are the *same loop* with different policies — which is the proof of completeness: the variety lives in ordinary library functions and the primitive stays dead-simple. Combinators are **library functions, not keywords**, and for the common *fixed-set* case they hide the nursery entirely — `fix (user, posts) = await all!(fetchUser!(id), fetchPosts!(id))` opens a nursery internally and returns the shaped results. The explicit `nursery n { … }` is for the *dynamic* case (tasks discovered over time).

**Staging.** A beginner's first async is a single `await fetchUser!(id)` — one inert task, started and awaited on the spot; *no* concurrency, because they do one thing at a time. Structured concurrency (nurseries) appears only when "I want two slow things at once" first arises, which is genuinely late — and `args` (§11) defers most in-program I/O, so even the first `await` lands well after the early lessons. Scheduling is at the **VM level** (suspension points are natural fuel-yield points, §12).

**Deferred details** (the model is settled; these are mechanics): the exact shape of the per-child completion surface — an imperative pull (`n.nextCompletion()`) vs. a **channel** of completions — and, tied to it, whether channels enter the language at all (they would also serve the dynamic-*and*-collecting case, potentially unifying combinator internals with result-collection under one concept); plus how `start` hands back a result/handle, cancellation semantics (how a cancelled task unwinds), and multi-failure aggregation when several siblings fail at once (first-wins-and-cancel, à la Swift, vs. collect-all). See §15.

---

## 9. Error handling & diagnostics

- **Two tiers of failure.** A **bug** crashes loudly and uncatchably — index out of bounds, overflow, divide-by-zero — with a precise message, location, and locals; you *fix* it, you don't handle it (the right first model of failure). An **expected failure** is a **value**: its possibility sits in the return type, so it can never tunnel invisibly up the stack the way an exception can. Indexing shows both tiers on *one* operation: `xs[i]` returns `T` and **crashes** on an out-of-range index (you asserted it was valid — so a bad one is a bug), while `xs.at(i)` returns `T?` — the same lookup treated as an *expected* maybe-absent value. You pick the accessor that matches whether an out-of-range index would be a mistake to fix or a real possibility to handle.
- **Absence is `Optional<T>`, spelled `T?`** (§4). **Failure-with-a-reason is `Result<T, E>`** — a two-case union `Ok{ value: T } | Err{ error: E }` — with the surface spelling **`T orelse E`** (`fix parse = fn(s: String) -> Int orelse ParseError`). Both `T?` and `T orelse E` are sugar for one underlying union; `Result<T, E>` stays writable for generic code and aliases (`type IOResult<T> = Result<T, IOError>`). `orelse` reads "a T, or else an E" — a *returned value*, never a thrown, stack-unwinding exception.
- **`match` is the full handler.** A `Result`/`Optional` is just a union, so you open it with the exhaustive `match` you already have, both cases handled, the `Err`'s reason in hand. No new construct.
- **`try` is the propagation shorthand**, spanning both `Optional` and `Result`: `try expr` unwraps the good case and continues, or **early-returns the bad case from the enclosing function**. It desugars to exactly that match — `fix lines = try readLines(path);` ≡ `match (readLines(path)) { Err{ error } -> return Err{ error }; Ok{ value } -> value; }`. Because it early-returns the bad case, **a function that uses `try` must itself return a compatible `Optional`/`Result`** — the compiler enforces it, so fallibility is forced into the signature and cannot hide. Every propagation point is *visible* (you see each `try`) and *typed* (the enclosing function admits it can fail) — the exact opposite of exceptions.
- **`??` is the gentle Optional default — Optional only.** `opt ?? fallback` takes the value or, on `None`, the default. It is *not* allowed on `Result`: a `None` carries no information so defaulting it discards nothing, but a `Result`'s `Err` carries a reason, and silently dropping that reason is exactly the dishonesty Ascent refuses. So seeing `??` tells you the left side is an Optional. `Result` errors must be *acknowledged* — handled (`match` / `try` / `try…else`) or surfaced (`.orAbort()`, below) — never silently defaulted away.
- **`.orAbort(message?)` is the escape hatch that *reports the error*.** A method on `Result`/`Optional`: it unwraps the good case, or aborts through the bug-tier crash (§9 format: location + locals). On a `Result` the abort **reports the carried `Err`** — the most informative thing available — so the default for "I don't want to handle this" surfaces the real reason instead of throwing it away. The optional message *augments*, never replaces: `config.orAbort("loading settings")` shows your context **and** the underlying error. On an `Optional` (no error to carry) it aborts with a locator, plus the message if given — the honest "I asserted this is present." It is a *method* precisely because the receiver is the value, so it can read the `Err` that a bare keyword cannot. This is the "abort and log the error" default; reach for it in scripts and proven-safe spots, and — being a visible call — every such gamble is greppable.
- **`abort "reason"` is the unreachable-branch tool, not an error tool.** A diverging expression (type `Never`, §7) for the case where there is *no* error value to report — a `match` arm or `else` branch you have proven impossible, a broken invariant — so the human `reason` is the only information there is, and is therefore required. It is deliberately **outside the error-handling story**: it is never the way to "skip" a `Result` (that is `.orAbort()`, which reports the real error) and is not taught as such. It composes anywhere a value is expected because it diverges (`match (x) { A -> 1; B -> abort "B is filtered out earlier" }`).
- **No fallibility keyword on the producer side** (no `throws fn`). Asynchrony needs `async` because it is invisible *behavior* (§8); failure needs no marker because it is *data* already named in the return type. The type is the marker.
- **`await` and `try` are orthogonal and compose.** `await` turns a pending async value into a finished one; `try` unwraps-or-propagates a fallible one; stack them — `try (await fetch(url))` — with no fused `async throws` construct. Keeping them separate is what makes them composable and transferable (Rust's `result?`, Swift's `try await`).
- **Multiple `try`s collect at one return type.** Because each `try` early-returns its bad case from the enclosing function, *every* `try` in a function must propagate an error that fits that function's single declared error type. Differing sources do not combine implicitly (§6: no anonymous unions) — you declare the combining union and adapt into it.
- **`try expr else e -> mapExpr` maps the error before propagating.** On the bad case it binds the error to `e`, evaluates `mapExpr` to a *new* error, and early-returns that — adapting a foreign error into the function's declared type, explicitly, at the call site:
  ```ascent
  type SolveError = Read{ cause: ReadError } | Parse{ cause: ParseError };

  fix solve = fn(path: String) -> Int orelse SolveError {
      fix lines = try readLines(path)     else e -> SolveError.Read{ cause: e };
      fix nums  = try parseNumbers(lines) else e -> SolveError.Parse{ cause: e };
      Ok{ value: sum(nums) }
  }
  ```
  It adds no new concept — it is the desugared `Err` arm made visible (`Err{ error: e } -> return Err{ error: mapExpr }`), reusing `match`'s `->` "arm produces" shape. So **`try` is the no-mapping shorthand and `try … else` the mapping form.** (For an `Optional`, whose bad case carries nothing, the binding is dropped: `try opt else -> SomeError{...}` turns a `None` into a propagated error.)
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
export fix distance = fn(a: Point, b: Point) -> Float => ... ;

fix helper = fn() -> Int => ... ;     # no export → file-private
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

**No ambient function prelude — every function is imported.** There is no built-in `print`, no global `len`, no standard library dumped into scope: *every function is a library capability reached through an explicit import*, so provenance stays local for functions too. This costs a beginner nothing, because three earlier choices make functions *late*: output is the program's returned value (the block-value rule, §2), not a `print` call; input is the `args` preamble (§11), not a function; and inspecting a value mid-development is a *tooling* concern (the REPL echo / playground inspector, §13), not a language function. A learner computes with values, `args`, `match`, methods, and their own definitions — and the first *imported* function arrives only when a genuine library capability is needed, by which point the module system is no longer daunting. One distinction to keep crisp: the language's built-in **vocabulary** — its types (`Int`, `String`), constructors (`True`, `None`, `Ok`), and operators (`div`, `mod`, `**`) — is *not* an imported function prelude; it is the language itself, ambient like grammar. "Everything is imported" governs *functions*, never the built-in vocabulary — you no more import `Int` than you import `+`.

Reserved words: `import`, `export`, `from`.

---

## 11. The environment & UI model

A browser-based **canvas**. You open a code panel to write a program; a program can spawn new interactive panels onto the same canvas.

**Program input — `args`.** Before any UI (or even functions), a program asks for typed values with an `args` preamble — a parenthesized, typed list at the very top, terminated by a semicolon (which closes the clause, marking the end of the signature before the body begins):

```ascent
args (age: Int, name: String);

"Hi ${name} — next year you'll be ${age + 1}"
```

- **A program has three parts, in one fixed enforced order: imports → `args` → body.** Imports may not follow `args`, and `args` may not follow body code. The order is not stylistic but **dependency order**: imports bring names into scope, an `args` field may be typed by an imported name, and the body consumes the args — so each part may use only what is declared above it (the same rule as "no slot used before its `fix`"). A violation is a teaching diagnostic ("`args` must come before the program body, because the body uses the args"). The three map exactly onto the program-as-`main` model (below): **the whole file *is* the definition of `main`** — imports are what is in scope for it, `args` is its parameter list, the body is its body — so a program reads like any function: scope, then signature, then body. Imports stay **individual `import` statements grouped contiguously at the top** (§10), *not* an `args`-style parenthesized block — because `args` is *one* declaration (the input record, so a block fits it) while imports are *many* independent declarations each with its own `from` source, so a shared block-shape would falsely unify them. The imports region is a block by *adjacency* (a visual zone), not by delimiter: positional uniformity, which is honest, rather than syntactic uniformity, which would lie.
- **Gathered and validated before the body runs.** The environment reads the `args` list, builds a fitting input dialog (one field per arg), collects the values, and **validates each to its declared type at the boundary** — type "abc" into an `Int` field and it re-asks, so the body never runs with a bad value (§6: external data is parsed into a declared type at the boundary). By the time the first body line executes, every `args` slot already holds a value, so the body stays fully synchronous and pure — no `await`, no effects.
- **What makes a type an `args` type:** it must have a single canonical input widget *and* a total-or-cleanly-validating parse from what the user types. That rule — not expressibility — decides membership, because `args` is a boundary: every admitted type is a widget to render and a garbage-input failure to handle gracefully.
- **v1 allows the four scalars**, each with one obvious control: `String` → text field (any text is valid, so it never fails), `Int` / `Float` → number field (re-asks on `"abc"`), `Bool` → checkbox. (The CLI supplies the same values as flags / stdin instead of a modal.)
- **Growth path, as the type system fills in:** an **enum** (zero-field union like `Small | Medium | Large`) → a dropdown whose options *are* the variants, so it cannot produce an invalid value — the case where types most earn their keep at the boundary (arrives with `type`, §12 stage 4); then **`T?`** → a leave-blank field yielding `None` (pending one decision — does an empty text field mean `None` or `""`?); then **`List<T>`** → an "add another" repeatable field.
- **Structured values stay out** — records, field-bearing unions, `Map`, `Ref`, and function types have no honest single widget. Don't ask for a `Point`; write `args (x: Int, y: Int)` and let the program build it. The boundary takes flat, named scalars and the program assembles richer values from them — which keeps `args` a parameter list, not an arbitrary-data deserializer.
- **Not a new slot kind.** Each arg is an ordinary fixed slot whose initializer happens to be the user rather than a literal; the required annotation is honest, since there is nothing to infer from.
- **Staged path to functions.** The `args (...)` list is written in the exact `name: Type` form of a parameter list — because that is what it is. A script is the body of an implicit `main`, and `args` is its parameter list, supplied by the environment as caller. When functions arrive (§12, stage 3) this is revealed — "that `args` line was `main`'s parameters; here is `fn`" — so the chapter-one affordance *is* the function mechanism, met in stages, with nothing unlearned.
- **Graduation note.** Real-world program arguments (`argv`, `sys.argv`, `String[] args`) arrive as a raw, positional list of *strings* the program indexes and parses itself; Ascent names them and checks their types for you — the same idea with training wheels. `prompt()` (later, once functions exist) removes the wheels by handing back a raw `String` you parse yourself.

- **UI as values.** `Element` is a stdlib tagged union — a tree of elements — so no new language features are needed: `match` + unions + first-class functions are the whole MVU basis. Buttons carry **message values**, not callbacks (no `this`, no listener lifecycle), and **exhaustiveness checking becomes a UI feature** — add a button, the compiler demands you handle its message.
- **MVU, pure.** A panel is three pure pieces: a `Model`, `view : Model -> Element`, and `update : (Model, Message) -> (Model, Command)`. `view` *returns a description* of the screen (it never draws); `update` *returns* the next model and a *description* of any effect (it never performs one). Both stay ordinary pure functions.
- **Effects as data — the honest answer to "pure code that must do I/O".** A pure `update` cannot `await fetch(...)` without becoming async and breaking the loop, so it doesn't: it returns a **`Command`**, a *value* describing an effect ("fetch this URL; deliver the result as *this* message"), and the **runtime** performs it. The runtime loop is the single impure component — written once, in the stdlib, not by users: it `await`s the next event, calls pure `update`, performs the returned command with the structured-concurrency machinery of §8 (a nursery + `await`), and feeds the result back as a new `Message`. So the async engine of §8 is the machinery and commands are the pure instructions handed to it — **users write only pure `view`/`update` returning `Element`/`Command` values, and never write `async`/`await` or touch a nursery to build a UI.**
- **Failure re-enters as a message.** A command that can fail (`httpGet` is `... orelse NetError`) is run by the runtime; its `Result` returns as a `Loaded{...}` or `Failed{...}` *message*, handled by pure `update` via `match`. Errors flow through the §9 model as ordinary data — never exceptions, never unhandled rejections.
- **Subscriptions** are the same idea for *ongoing* effects: a pure `Model -> Subscription` value declaring "while in this state, listen to this timer / socket." The runtime **diffs** it as the model changes and runs the active ones as model-scoped structured-concurrency tasks (§8), so starting, stopping, and resource cleanup fall out of nursery-scope cancellation automatically. This is where the old `with` / resource-cleanup question resolves.
- **One boundary, three positions.** `args` (input *before* the run), `await` (waiting *during* it), and commands (effects out, results back as messages) are the same edge — between pure computation and the uncertain outside world — at different times. A teaching spine, not three disconnected features.
- **Transfer to React (the maturity target).** The deep, durable concept transfers *exactly*: **UI is a pure function of state**, unidirectional data flow, and `update : (Model, Message) -> Model` *is* React's `useReducer` reducer `(state, action) => state` — a student arrives at React already fluent in the hard part most juniors fumble for years. What does *not* match is React's **`useEffect`** (imperative effects in a hook) versus effects-as-data — and Ascent deliberately does **not** bend toward `useEffect`, because that is React's most-regretted, in-flux part and React is itself migrating *toward* declarative effects (Server Components, `use`, Suspense). Teach effects-as-data proudly as the model React is converging on; tune *vocabulary* (state, component, reducer) toward React for free verbal transfer.
- **Composability is required, not optional.** The model must support **nested view/update with local state** (sub-components), because React is built on component composition and this is the one architectural property that is both genuinely needed and painful to retrofit — flagged in §15 as the React-transfer-critical constraint the design must honor from the start.
- **Learning ramp:** (1) `print` → console panel; (2) static UI via `show(element)`; (3) `Model` + `update` returning `Command.None` always — fully interactive UIs with **no effects and no async** for several lessons; (4) `Command.fetch` / subscriptions as a later reveal, exactly when real-world I/O first appears. Effects are opt-in and late, like `await` itself.
- **Environment affordances** (cheap because state is immutable and view/update are pure): live state inspector, time-travel history scrubber, state-preserving hot reload, multiple independent panels.

---

## 12. Implementation & build path

**Built by hand, prototyped in JavaScript, hardened in Rust.**

- **Hand-written lexer and recursive-descent parser — no generators.** Error messages are the product (§6, §9), and generated parsers produce poor ones. A hand-written lexer is also the only thing that cleanly handles Ascent's *stateful* lexing: string interpolation (`${expr}` flips between string- and expression-mode) and nested `#[ … ]#` comments. Expression precedence (§5) uses **Pratt parsing** (precedence climbing). All of it ports to Rust unchanged.
- **Prototype first in JavaScript** (the author's home language) as a **tree-walking interpreter**, then port to the Rust core below. In the JS prototype, `Int` is a `BigInt` and `Float` a `number`; all-`Int` arithmetic stays exact in `BigInt`, and mixed arithmetic promotes the `BigInt` to a `number` (the one-way `Int` → `Float` rule). Honest 64-bit overflow trapping is a later refinement.
- **Dynamic first, types later.** The interpreter runs without static checking at first; the **type checker is a separate pass** added once the core works. This decouples "it runs" from "it typechecks" and keeps each stage small.
- **Persistent collections.** Because no value mutates and "change" is rebinding a slot (§3, §6), the built-in collections are **persistent data structures** with structural sharing (à la Clojure / Elm): `append` / `with` / `sort` return new values that share most of their structure with the old, so rebind-in-a-loop is efficient (≈ O(log n) per step, not a full copy) and value-copy on assignment is cheap. This is what makes immutable-everything performant rather than a quadratic trap — and if a genuine hot loop ever needs raw speed, a single quarantined mutable *builder* (Clojure's transients, or an array behind `Ref`) is the opt-in escape (§15).

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
- **REPL / playground.** A terminal REPL (auto-prints each expression's value) and a browser playground. Both surface a **type-inspection** query — "what type does the checker infer for this expression?" — because a beginner asks it constantly, especially of the `Int`/`Float` promotion (is `x / 2` an `Int` or a `Float`?). It has two surfaces for two environments: **hover / inspect** in the playground, and a **`:type` / `:t` meta-command** in the REPL (`:t x / 2` → `Float`). Crucially this is a **tooling feature, not a language operator** — there is deliberately no `typeof` in the grammar. A type is a *compile-time* fact the tool reports, never a runtime value program source can interrogate; a runtime `typeof` would contradict the no-runtime-type-interrogation basis of the nominal type system (§6) and seed exactly the branch-on-runtime-type habit Ascent forecloses. The `:` prefix marks REPL meta-commands (`:type`/`:t`, `:doc`, `:load`, `:reload`, `:quit`) as instructions to the REPL, never Ascent code — so "ask the type" lives honestly in the developer tool, in both the terminal and the browser. (A learner can also *assert* a type actively with an annotation — `fix x: Float = a / b`, which the compiler confirms or corrects with the real type — the static, checked counterpart to `:type`.)
- **Built-in `assert` + test runner** — the on-ramp to "is my code correct?" needs no installs.

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
  - **Phase 1 (now, no traits): `List<T>` as a concrete built-in.** A persistent data structure with structural sharing (§12 — start with a persistent vector, RRB-tree later; swappable without semantic change). `for x in xs` is hard-coded for `List` (it is the eventual `Iterable` desugar target, concrete for now). Methods are base-verb / returning (§6): `map`, `filter`, `reduce`, `find`, `contains`, `append`, `insert`, `remove`, `at` (→ `T?`) and `[i]` (→ `T`, crash-out-of-bounds, §9), `length`, `isEmpty`, `reverse`, `slice`, `concat`, and — hard-coded for the built-in comparable elements (`Int` / `Float` / `String` / `Bool`) — `sort`, `min`, `max`. **Write the signatures as if the element traits already existed** (so `sort` assumes "elements compare"), hard-coded for built-ins now; when the trait lands, `sort` generalizes to `T: Comparable` *without changing its shape*. This is buildable today and is exactly what early lessons need.
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
