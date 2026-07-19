# Ascent Stdlib — `scalars`

### Methods on `Int`, `Float`, `Bool`, `String`

> The four scalars (§4) carry a **small, curated** set of built-in methods: conversions between them, and a few numeric operations. Everything mathematical beyond that lives in an imported **`math`** module of free functions, *not* on the number types — so a scalar's method list stays short and every method on it earns its place.
>
> Text operations on `String` (`trim`, `split`, `chars`, `slice`, …) are the **`string`** module and are documented separately; this module covers only String's *conversion* methods, since those belong with the conversion family.

---

## The inclusion test

A method belongs on a scalar only if it is **a property of *this one value*, and clearer named than spelled as an expression.**

- `3.7.round()` is a property of `3.7`; `(-5).abs()` is a property of `-5` → **methods**.
- `max(a, b)` is a relation *between two* values (no natural receiver) → **`math` free function**.
- `sqrt(x)`, trig, `gcd` are *library math* → **`math` module** (so reaching for them reads as "I'm using math," and they don't clutter every number).

The test keeps the surface tiny: **conversions + rounding + `abs`**, and a `math` module for the rest.

---

## Conversions

Every conversion is a **method on the source value**, spelled `value.toTarget()`, and its **return type carries the honesty**: it returns `Target` when the conversion *always* succeeds, and `Target?` when it can fail. So the `?` tells you, at a glance, whether a conversion can fail — the same signal as everywhere else in the language.

### To `String` — always succeeds (`Display`)

```
(any Display value).toString(): String
```

`42.toString()` → `"42"`, `True.toString()` → `"True"`, `3.5.toString()` → `"3.5"`. Uses the canonical `Display` form (§7) — the same one `${}` and `print` use. Structured types don't satisfy `Display` yet, so `.toString()` is a scalar (and later, opt-in `Display`) operation, never a universal method every type gets for free (§6).

### From `String` — can fail, returns `T?`

```
(String).toInt(): Int?
(String).toFloat(): Float?
(String).toBool(): Bool?
```

`"42".toInt()` → `42` (an `Int?` holding the value); `"abc".toInt()` → `None`. The `?` is unavoidable — a string might not name a number — so parsing forces you to handle the miss (`?? default`, `match`, `try`). This is the same fallibility the prelude's `promptInt` *hides* by re-asking; here, at a value boundary, absence is a real outcome you handle.

### `Int` → `Float` — always succeeds

```
(Int).toFloat(): Float
```

Every `Int` is a `Float`, so this widens and cannot fail — plain `Float`, no `?`. (`.toFloat()` thus returns `Float?` *from a String* but `Float` *from an Int* — exactly the "return type = can it fail" rule.)

### `Float` → `Int` — the rounding family (name the intent)

A `Float` does **not** have a bare `.toInt()` — converting to `Int` loses the fractional part, and *how* it's lost is a decision the caller must make, so it is named, never hidden:

```
(Float).trunc(): Int   # toward zero:   3.7 -> 3,  -3.7 -> -3
(Float).round(): Int   # nearest:       3.7 -> 4,   3.4 -> 3
(Float).floor(): Int   # toward -inf:   3.7 -> 3,  -3.2 -> -4
(Float).ceil():  Int   # toward +inf:   3.2 -> 4,  -3.7 -> -3
```

All return a plain `Int` (a finite `Float` always rounds — no `?`). Requiring the caller to pick `trunc` / `round` / `floor` / `ceil` makes the rounding explicit, where a bare `.toInt()` would silently pick one and surprise half its users.

```ascent
fix n = await promptInt!("How many?")           # Int, no parse needed
fix parsed = "42".toInt() ?? 0                   # Int? -> Int with a fallback
fix price = "9.99".toFloat()                      # Float?
fix cents = (9.99 * 100.0).round()                # Float -> Int, rounding named
```

---

## Numeric methods

Beyond conversions, the numeric scalars carry exactly one more method:

```
(Int).abs():   Int
(Float).abs(): Float
```

Absolute value — a property of the value, and clearer than `if (x < 0) { -x } else { x }`. Returns the same type.

That is the whole non-conversion method set. In particular, scalars do **not** carry `pow` (the `**` operator covers it), `min` / `max` (relations between two values → `math`), `sqrt` / trig / `gcd` (library math → `math`), or bit operations.

**Judgment call left open:** `Int.isEven()` / `isOdd()` read nicely and are common in exercises, but they are one `mod` away (`n mod 2 == 0`) — and letting the idiom be `mod` *teaches* `mod`. Started **out**; add only if beginner code feels clunky without them.

---

## What is *not* a scalar method — the `math` module

Everything that fails the inclusion test lives in an imported **`math`** module of **free functions**, so the number types stay clean and using math reads as an explicit choice:

```ascent
import { min, max, sqrt } from "math"

fix lower = min(a, b)          # a relation between two values — free function
fix hyp   = sqrt(x*x + y*y)    # library math — free function
```

- **`min(a, b)` / `max(a, b)`** — two-value relations (no natural receiver). *(Min/max over a **collection** is a `List` method — `xs.min()` / `xs.max()` → `T?` — a different operation, documented with `list`.)*
- **`sqrt`**, and later `pow`-if-ever (though `**` already covers power), plus trig / log as the need arises.
- **Constants** `pi`, `e`.

`abs` is the one borderline case kept as a *method* rather than banished to `math`, because it is so common and so clearly a property of a single value; `min` / `max` are not, because they inherently involve two.

---

## Settled decisions

- **Conversions are methods on the source value** (`value.toTarget()`), returning `Target` when infallible and `Target?` when fallible — symmetric with `.toString()`, and the `?` makes failability visible. Not `Int.parse(...)` (Ascent has no static members on types) and not `parseInt(...)` free functions (would break the `.toString()` / `.toInt()` method symmetry).
- **`Float` → `Int` is the named rounding family** (`trunc` / `round` / `floor` / `ceil`), never a bare `.toInt()` — the rounding decision is the caller's and stays explicit.
- **The scalar method surface is conversions + rounding + `abs`;** all other math is the imported `math` module, gated by the "property of this value, clearer named than spelled" test.
