import { type AscentType, isScalarType } from '../types/types.js';

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
export type Trait = 'Display';

// Whether a type satisfies a trait. One `switch` per trait keeps each trait's
// membership in a single spot; adding a trait (e.g. Iterable) adds a case here.
export const satisfies = (trait: Trait, t: AscentType): boolean => {
  switch (trait) {
    case 'Display': return isScalarType(t);
  }
};
