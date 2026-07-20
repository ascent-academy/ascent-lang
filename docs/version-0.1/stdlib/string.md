# Ascent Stdlib — `string`

### Methods on `String`

> `String` is an **immutable** Unicode sequence (§4). Every method returns a **new** string (or a value), never mutating the receiver — the one uniform value-semantics story. The defining design choice: **operations that touch position or length work in *graphemes* — user-perceived characters — by default**, and any method reaching for a lower unit (code point, byte) *says so in its name*. That is why there is no `s[i]` (§4): "the *i*-th character" has no single honest meaning over Unicode, so Ascent replaces the lying index with named, unit-explicit methods.
>
> Two neighbours: **building** strings is `${}` interpolation (§4), not `+`; **parsing** a string to a number (`toInt` / `toFloat` / `toBool` → `T?`) is the conversion family in `scalars.md`. This module covers everything else you *do to* a string.

---

## The unit principle

A `String` can be measured three ways, and they disagree — `"Dvořák"` is 6 graphemes, 6 code points, and 7 bytes; `"👨‍👩‍👧"` is 1 grapheme but 3 code points and many bytes. So Ascent makes the unit **explicit and defaulted to the honest one**:

- **Grapheme** (default) — what a human calls "a character." `length`, `first`, `chars`, `slice` all work here, because it is what a beginner means.
- **Code point** / **byte** — named methods (`codePoints`, `bytes`), reached only when you know you need them.

No method silently picks a unit, and none pretends O(1) random access it cannot deliver — the trap `name[0]` sets on `"Dvořák"` simply does not exist.

## Everything is a method — built-ins have no properties

On a built-in type there are **no bare-property accessors**: every operation, including `length()` and `isEmpty()`, is a **method call** with `()`. The only bare `.name` in the language is a **record field** (§6, single-variant types only) — so `.` means exactly two distinguishable things: `x.field` reads a stored field of a record, `x.foo()` invokes an operation on any value. `String` is not a record, so it exposes only methods.

This is also *honest about cost*: grapheme `length()` is **O(n)** (it must walk the string to count user-perceived characters), so presenting it as a free-looking field would be the same lie as O(1) indexing. It does work; it is called like work.

---

## Length & emptiness

```
(String).length():    Int      # grapheme count — O(n)
(String).isEmpty():   Bool
```

`"café".length()` is `4`. `isEmpty()` is `length() == 0`, named for readability (parallels `List.isEmpty`).

## Accessing characters — no index, named units

```
(String).first():  String?          # first grapheme, None if empty
(String).last():   String?          # last grapheme, None if empty
(String).chars():  List<String>     # the graphemes, each a length-1 String
(String).slice(from: Int, to: Int): String   # substring, half-open [from, to)  (R0006 on a bad bound)
(String).drop(Int): String          # all but the first n graphemes ("the rest, from n")
(String).take(Int): String          # the first n graphemes
```

- `first` / `last` return `String?` because an empty string genuinely has neither — absence is a normal value, not a crash (§9). (There is no crashing "first character," because there is no `s[0]` to crash.)
- **Positional access goes through `chars()`** — `s.chars().at(2)` (→ `String?`, safe) — rather than a string index. There is deliberately no `s.at(i)` on `String`: routing through `chars()` makes the O(n) walk and the grapheme unit both visible, instead of hiding them behind a bracket.
- **`slice` takes two grapheme indices, `from` and `to` (half-open)** — `s.slice(2, 5)` is graphemes 2, 3, 4. Not a `Range`: `Range` otherwise earns its place as the `for x in 0..n` iterator (§5), and requiring learners to know `Range`-as-a-value for the *one* place `slice` uses it would teach a concept for a single use. An out-of-range bound is `R0006`.
- **`drop` / `take` cover the ends** — the common "from index *n* to the end" is `s.drop(n)` and "the first *n*" is `s.take(n)`, so you rarely need `slice` at all; `slice` is for a genuine middle chunk. (`drop` / `take` also exist on `List` — same operation; this is what keeps `drop` out of the keyword set, §2, paying off.) `drop(n)` past the end yields `""`; `take(n)` past the end yields the whole string (both saturate rather than crash — they describe "up to n," not an assertion about length).

## Searching & testing

```
(String).contains(String):   Bool
(String).startsWith(String): Bool
(String).endsWith(String):   Bool
```

Substring predicates — the common "is it in there / does it begin or end with" questions, all returning `Bool` (no index leaks out, so no grapheme-vs-byte ambiguity to resolve). A position-returning `indexOf` is **deliberately omitted** (see notes): it would have to commit to an index unit, reopening exactly what no-indexing closed.

## Transforming (each returns a new `String`)

```
(String).toUpper():        String
(String).toLower():        String
(String).toTitle():        String      # capitalize the first letter of each word
(String).trim():           String      # strip leading & trailing whitespace
(String).repeat(Int):      String      # n copies (R0007 on a negative count)
(String).padLeft(Int):     String      # pad with spaces to at least the given width
(String).padRight(Int):    String
```

- `toTitle` splits on whitespace runs, uppercases each word's first grapheme, and lowercases the rest — `"hello world".toTitle()` is `"Hello World"`. Words are whitespace-delimited only (`"hello-world".toTitle()` is `"Hello-world"`, one word); runs of whitespace and leading/trailing whitespace are preserved untouched, unlike `trim`.
- `trim` removes whitespace from both ends; `trimStart` / `trimEnd` are the one-sided variants.
- `repeat(3)` on `"ab"` is `"ababab"`; `repeat(0)` is `""`; a negative count is the loud crash `R0007` (a repeat count is an assertion it is non-negative, bug-tier — §9).
- `padLeft` / `padRight` pad with spaces up to `width`; a string already at least that wide is returned unchanged (never truncated).

## Splitting

```
(String).split(String): List<String>   # split on a separator
(String).lines():       List<String>   # split into lines
```

`"a,b,c".split(",")` is `["a", "b", "c"]`. `lines()` splits on line breaks — the common file-processing need. *(The inverse, joining a `List<String>` with a separator, is `list.join(sep)` — a **`List`** method, in `list.md`, since the receiver is the list.)*

## Lower-level units (advanced)

```
(String).codePoints(): List<Int>    # Unicode scalar values
(String).bytes():      List<Int>    # UTF-8 bytes
```

The escape hatch for when graphemes are the wrong unit — interop, encoding work, low-level algorithms. Named so the unit is unmissable, and *late*: a beginner never meets these until they have a reason to. This is the graduation payoff of no-indexing — you don't lose byte access, you *name* it.

---

## Building & parsing — not here

- **Build** a string with `${}` interpolation (§4): `"Hi ${name}, you have ${count} messages"`. No `+` on strings (overloading `+` is JavaScript's `1 + "2"` trap, §4), and no `++`. Repetition/padding above cover the fixed-shape cases.
- **Parse** a string to a number with the conversion family in `scalars.md`: `s.toInt()` → `Int?`, `s.toFloat()` → `Float?`, `s.toBool()` → `Bool?` — fallible, so each returns `T?`.

---

## Shipped in v0.1

Live today: **`length()`, `isEmpty()`, `first`, `last`, `chars`, `slice(from, to)` (`R0006`), `drop(Int)` / `take(Int)`, `contains` / `startsWith` / `endsWith`, `toUpper` / `toLower` / `toTitle`, `trim` / `trimStart` / `trimEnd`, `repeat(Int)` (`R0007`), `padLeft(Int)` / `padRight(Int)`, `split(String)`, `lines()`, `codePoints()`, `bytes()`.** The string→number conversions (`toInt` / `toFloat` / `toBool`) are likewise shipped, and documented in `scalars.md`.

*(Note: the v0.1 whitepaper's method table shows `length → Int`; read it as the method `length()` — built-ins have no bare properties, per above.)*

---

## Settled decisions

- **Everything is a method; built-ins have no properties.** `length()`, `isEmpty()`, and all operations are `()`-called. The only bare `.name` is a record field (§6). This is honest about cost — grapheme `length()` is O(n), not a free field.
- **Grapheme-default, unit-explicit.** Position/length methods work in graphemes; code-point and byte access are named methods, reached deliberately. No method silently picks a unit.
- **No `[]` on strings — firmly, not even for slices.** Positional character access is `chars().at(i)`; `first` / `last` cover the ends (→ `String?`); a middle chunk is `slice(from, to)`; the ends-to-here cases are `drop` / `take`. The bracket stays off `String` entirely, so `s[0]` never tempts and never lies.
- **`slice` takes two indices, not a `Range`.** `Range` is reserved for its real job, iteration (`for x in 0..n`, §5); `slice(from, to)` needs no range-as-value concept. `drop` / `take` handle the open ends.
- **No position-returning search (`indexOf`).** `contains` / `startsWith` / `endsWith` answer the common questions without leaking an index whose unit would be ambiguous. Revisit only if a concrete need outweighs reopening the unit question.
- **Immutable — every method returns a new `String`.** No in-place mutation, consistent with value semantics (§3).
- **Building is interpolation, parsing lives in `scalars`.** This module is transformations, tests, and splits; it does not duplicate the conversion family.
