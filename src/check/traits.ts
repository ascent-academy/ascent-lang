import { type AscentType, INT_TYPE, isScalarType } from '../types/types.js';

// ---- Intrinsic traits (compiler-known capabilities) -------------------
//
// A trait names a capability a type may have. These are *intrinsic*: the
// compiler knows a fixed set and which built-in types satisfy each — there is
// no user-facing `trait`/`impl` syntax yet (whitepaper §15/§16). They give a
// name, and one place to check, to the "hard-coded bound" the language already
// leans on — so a bound can appear in a signature (`print<T: Display>`) instead
// of being re-open-coded at each call. No generics ride along: a bound only
// ever *constrains* an argument, it never escapes into a result, so `satisfies`
// is a plain predicate, not type inference.

// Display: "has a canonical text form" — the bound on an interpolation hole and
// on print's argument. Today exactly the built-in scalars satisfy it
// (Int/Float/Bool/String), the same set `isScalarType` picks out; when a real
// trait system lands this becomes ordinary dispatch instead of a fixed rule.
//
// Comparable: "can be ordered" — the bound on the stdlib 'math' module's min/max
// (whitepaper §10; 🔒 scalar-hardcoded until a real trait system lands, §15). The
// orderable scalars are exactly those '<'/'>' already accept (§5): Int, Float,
// and String — not Bool, which has no order.
//
// Iterable: "can be walked one element at a time" — the bound a 'for x in xs'
// loop puts on `xs` (whitepaper §5/§7; 🔒 hardcoded to List | Range until a real
// trait system, §16). It is the trait that *forces an associated type*: unlike
// Display/Comparable, satisfying it isn't a bare yes/no — the loop also needs the
// *element* type each pass yields (`xs`'s `Item`, in trait terms), which a plain
// predicate can't hand back. So Iterable's membership is *derived* from that
// projection (iterableElement below): a type is Iterable exactly when it has an
// Item.
export type Trait = 'Display' | 'Comparable' | 'Iterable';

// Iterable's associated type, `Item` — the type a 'for x in xs' loop binds each
// pass. `null` when `t` can't be iterated (the loop then reports T0017). This is
// the projection a real trait system would spell `<T as Iterable>::Item`; here
// its two implementors are hardcoded — a `List<T>` yields its element `T`, a
// `Range` yields `Int` — the same "hard-coded until traits land" state Display
// and Comparable are in, but carrying a *type out* rather than only a bound in
// (which is exactly what makes Iterable the harder of the three).
export const iterableElement = (t: AscentType): AscentType | null => {
  if (t.kind === 'List') return t.elem;
  if (t.kind === 'Range') return INT_TYPE;
  return null;
};

// Whether a type satisfies a trait. One `switch` per trait keeps each trait's
// membership in a single spot; adding a trait adds a case here. Iterable's case
// defers to its associated-type projection — having an `Item` *is* being
// iterable — so the two can never disagree.
export const satisfies = (trait: Trait, t: AscentType): boolean => {
  switch (trait) {
    case 'Display': return isScalarType(t);
    case 'Comparable': return t.kind === 'Int' || t.kind === 'Float' || t.kind === 'String';
    case 'Iterable': return iterableElement(t) !== null;
  }
};
