# Ascent Stdlib — `prelude`

### The ambient functions and types

> The **prelude** is the small, closed, **non-shadowable** set of stdlib **functions and types** in scope in *every* program with **no import**. Two groups: the **console I/O** a beginner needs before the module system (§10) is taught — output (`print`, `printInline`) and input (the async `prompt` family) — and a few **ambient helper types** (`Pair`, `Entry`, `Ordering`) that the collection types hand back, so they must be usable without an import. Everything else in the stdlib is reached through an explicit `import`. Enlarging the prelude is a language decision, never a slope.
>
> *(The whitepaper §4 lists `Pair` / `Entry` / `Ordering` in the type lattice and §10 gives the language-level prelude/import view; this module *defines* them.)*

---

## Output

Output is **synchronous** — writing to the console does not wait on anything, so `print` / `printInline` return `Done` immediately and need no `await`. (Contrast the `prompt` family below, which *does* wait on the user and is therefore async.)

### `print`

```
print<T: Display>(value: T): Done
```

Emit `value`'s canonical string form to the console, followed by a newline. *(Beginners just write `print(x)` — the `<T: Display>` bound is the stdlib signature, seen only on inspection, §7.)*

- **Anything that is `Display`.** `print` accepts any value whose type satisfies the intrinsic **`Display`** trait — the "has a canonical string form" capability (§7). Today `Display` is satisfied by the built-in scalars, so `print(42)`, `print(3.14)`, `print(True)`, and `print("hi")` all work directly, using the same canonical form the `${}` hole uses (Int → digits, Float → digits with the point always shown, Bool → `True` / `False`, String → itself, §4). This is the **same `Display` bound as string interpolation** — `print` and `${}` are two positions requiring the *one* capability, not two competing stringification mechanisms: `print(count)` applies `Display` directly, `print("count: ${count}")` applies it inside a template. A **structured type** (record, union, collection) does *not* satisfy `Display` yet — traits are not user-definable (§16) — so `print(user)` is a compile error directing you to a scalar field (`print(user.name)`) or an explicit conversion you wrote (`print(money.toStr())`), exactly as interpolation does. There is deliberately no universal `toString` (that would be an `Any`-supertype by another name, §6). When user traits arrive, a type opts into `print`-ability by implementing `Display`, with no change to what existing programs mean.
- **Newline-terminated.** `print` *always* appends a newline — the common case is "print a line," so the unmarked function does exactly that. There is **no `println`**: the C/Java pairing makes the constant case (with newline) the marked one and forces a beginner to remember which spelling adds the break. Here the one call does the thing you do 99% of the time.
- **The no-newline case is `printInline`** (below) — the marked twin for when you *don't* want the line to end.
- **Returns `Done`.** `print` is an effect; its value is `Done` (§4), so it sits happily as a statement and never triggers the `void` discard rule (§2).

```ascent
print("Hello, world!")           # Hello, world!⏎
print(42)                        # 42 — any Display value prints directly
print("You have ${n} messages")  # or interpolate to build a mixed line
```

### `printInline`

```
printInline<T: Display>(value: T): Done
```

Emit `value`'s canonical string form with **no** trailing newline — the twin of `print` for building a line in pieces or keeping output on the current line.

- **Same `Display` bound as `print`.** Any scalar prints directly (`printInline(42)`); a structured type is the same compile error, redirecting to a scalar field or `.toStr()`.
- **The marked member of the pair.** `print` (with newline) is the common default; `printInline` (without) is the deliberate exception you reach for. This is the *right way round* — the qualified name is the rare case, unlike C's `print` (no newline) / `println` (newline), which marks the common case and leaves the trap unmarked.
- **Returns `Done`** — an effect, like `print`.

```ascent
printInline("Loading")
printInline("...")
print("done")            # Loading...done⏎

for x in xs {
    printInline("${x} ")  # 1 2 3  — space-separated, one line
}
print("")                 # end the line
```

---

## Input — the `prompt` family (async)

Interactive input **waits on the user**, so it is genuine I/O and therefore **async** (§8): each prompt is an `async` function, called with the `!` mark to prepare a `Task` and run with `await`. This is deliberate — interactive input is a beginner's natural *first* encounter with "waiting for something to happen," which makes it the right place to introduce `await` concretely and early, so the concept is familiar long before concurrency proper.

```ascent
fix name = await prompt!("What's your name?")     # await + the ! call-mark
fix age  = await promptInt!("How old are you?")
```

Input also mirrors **`program`'s typed parameters** (§11): the type you want is part of the asking, and the boundary validates to that type — so the confusion "input is always a string even when I want a number" never arises.

### `prompt` — raw text

```
async prompt(message: String): String
```

Show `message`, read a line, yield it **as text**. Any input is valid text, so `prompt` never fails and never re-asks. This is the raw form and the **graduation path**: once a learner understands parsing and Optionals, `(await prompt!(...)).toInt()` (→ `Int?`) lets them handle bad input themselves — revealing that the typed prompts below are `prompt` + a validated parse.

### `promptInt` / `promptFloat` / `promptBool` — typed input

```
async promptInt(message: String): Int
async promptFloat(message: String): Float
async promptBool(message: String): Bool
```

Show `message`, read input, and **validate it to the declared type** — exactly as `program (age: Int)` validates its boundary. On invalid input (`"abc"` into `promptInt`) the prompt **re-asks**, looping until the user enters a valid value, then yields the clean scalar type. So:

- The yielded type is the **plain scalar** (`Int`, not `Int?`) — the beginner never confronts failure, because *re-asking is the correct behavior for an interactive prompt*: a tool that wants a number keeps asking until it gets one. This is not hiding failure; for interactive input, "keep asking until valid" **is** the honest semantics (unlike parsing a file, where absence is a real value you must handle — that is what `prompt` + `.toInt()` is for).
- These mirror `program`'s v1 scalar parameters one-for-one: `String` → `prompt`, `Int` → `promptInt`, `Float` → `promptFloat`, `Bool` → `promptBool`. Same types, same validation, same re-ask.

```ascent
fix name = await prompt!("What's your name?")     # String, any input valid
fix age  = await promptInt!("How old are you?")   # Int — re-asks on "abc"
print("Hi ${name}, next year you'll be ${age + 1}")
```

**Scope — do not proliferate.** The family is exactly the four scalars. Range-limited, choose-from-a-list, and similar richer prompts belong to the same *later* growth path as `program`'s structured inputs (enum → dropdown, etc.), not the core prelude.

---

## The two input boundaries mirror each other

Ascent has one input model, applied at two boundaries, with the same wheels-vs-raw graduation:

| | typed (training wheels) | raw (parse it yourself) |
|---|---|---|
| **Program start** (§11) | `program (age: Int)` — validated params | later: a raw-string arg you parse |
| **Interactive** (this module) | `await promptInt!("Age?")` — validated, re-asks | `await prompt!("Age?")` → `String`, then parse |

A learner meets the typed form first (the type is in the asking), and drops to the raw form once parsing and Optionals are understood. Nothing is unlearned — the typed prompt *was* the raw prompt plus a validated parse all along.

---

## Ambient types

Three small types ship **in scope, no import** — because the collection types hand them back (`zip` returns `Pair`s, a `Dict` iterates as `Entry`s, a custom sort returns `Ordering`), so requiring an import to *name what you already hold* would be absurd. They are ordinary `type`s, **consumed** exactly like `List` / `Optional` — you construct, read, and `match` them with the normal machinery (§6); you did not (and in v0.1 could not) *define* their generic form, since user-defined generics are v2 (§7).

### `Pair<A, B>` — two related values

```
type Pair<A, B> = { first: A, second: B }
```

The **named-not-positional** replacement for a 2-tuple (§6 rejects tuples). Two values with *named* fields — `p.first`, `p.second` — so there is no `.0` / `.1` index to mix up and a swap is impossible. Constructed and read like any record: `Pair{ first: 1, second: "one" }`, then `p.first`. `zip(xs, ys)` returns `List<Pair<A, B>>`; it is also the honest return type for a function producing two related values without a bespoke record.

### `Entry<K, V>` — a key-to-value association

```
type Entry<K, V> = { key: K, value: V }
```

Structurally a `Pair`, but **semantically a mapping** — the field names `key` / `value` say which is which, where `first` / `second` would not. This is what a `Dict` yields when iterated: `for entry in scores.entries() { print("${entry.key}: ${entry.value}") }`. Keeping `Entry` distinct from `Pair` is the same "names over positions" principle that rejected tuples — the semantic names are the whole point.

### `Ordering` — the result of a comparison

```
type Ordering = Less | Equal | Greater
```

A three-variant enum for a custom comparison result — the honest return of a comparator, matched exhaustively:

```ascent
fix byScoreThenName = fn(a: Player, b: Player): Ordering => match compareInt(a.score, b.score) {
    Equal -> compareStr(a.name, b.name),   # tie-break
    other -> other,
};
```

Chosen over the C/JS `-1 | 0 | 1` convention: those magic numbers are error-prone (which sign means "before"?) and un-`match`-able, whereas `Less` / `Equal` / `Greater` are self-explaining, exhaustive, and — being an ordinary tagged union — reinforce §6. `sortBy` with a custom comparator takes an `Fn(T, T) -> Ordering`.

*(Hashability, per §7: `Pair<A, B>` and `Entry<K, V>` are `Hashable` when their components are — the structural rule — so a `Pair` of scalars is a valid `Dict` key; `Ordering` is `Hashable` (it is a scalar-free but function-free enum). All three have universal `==` like any data.)*

---

## Settled decisions

- **`prompt` is async, on purpose.** Interactive input genuinely waits, so it is async (§8) — and teaching `await` at this first, concrete "waiting" moment is a deliberate pedagogical choice, so beginners are comfortable with it well before concurrency. Output (`print` / `printInline`) stays synchronous — it does not wait — so the async/sync split is honest: input waits, output doesn't.
- **The ambient helper types are `Pair` / `Entry` / `Ordering`,** in scope with no import because the collections return them. `Entry` is kept distinct from `Pair` for its semantic field names (`key` / `value`); `Ordering` is an enum, not `-1|0|1`. They are consumed like `List` / `Optional`, not user-definable (generics are v2, §7).
- **This module is the `prelude`** (matching the whitepaper's term; the earlier "preamble" is retired).
