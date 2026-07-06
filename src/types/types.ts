export type AscentType =
  | { kind: 'Int' }
  | { kind: 'Float' }
  | { kind: 'Bool' }
  | { kind: 'String' }
  | { kind: 'None' }
  | { kind: 'Done' }
  | { kind: 'Never' }
  | { kind: 'Invalid' }
  | { kind: 'List'; elem: AscentType }
  | { kind: 'Optional'; elem: AscentType };

export type TypeKind = AscentType['kind'];

export const INT_TYPE: AscentType = { kind: 'Int' };
export const FLOAT_TYPE: AscentType = { kind: 'Float' };
export const BOOL_TYPE: AscentType = { kind: 'Bool' };
export const STRING_TYPE: AscentType = { kind: 'String' };
export const NONE_TYPE: AscentType = { kind: 'None' };
export const DONE_TYPE: AscentType = { kind: 'Done' };
// design.md §7: the bottom type — uninhabited, assignable to every type. Not
// (yet) a type anyone writes; it only ever shows up as the checker's own
// inference for a diverging expression, or (below) an empty list literal.
export const NEVER_TYPE: AscentType = { kind: 'Never' };
// agenda/typechecker-refactor.md Phase 5: a checker-internal tombstone for a sub-expression whose
// own type-checking already failed (a diagnostic was reported at that node) —
// never written in source, never shown in a message. It is Never's dual:
// Never is the honest bottom of a *valid* program, Invalid marks a *broken*
// one. See subtype()/leastCommonType() below for the "absorbs both
// directions" rule that lets a failure stop at the point it's reported
// instead of cascading into new, misleading diagnostics further up the tree.
export const INVALID_TYPE: AscentType = { kind: 'Invalid' };
export const listOfType = (elem: AscentType): AscentType => ({ kind: 'List', elem });
export const optionalOf = (elem: AscentType): AscentType => ({ kind: 'Optional', elem });

// design.md §4: 'T?' is surface sugar for 'Optional<T>' — render it that way
// everywhere a type shows up (diagnostics, the REPL, the AST printers)
// rather than as 'Optional<T>', since that sugar is what a learner wrote.
export const typeToString = (t: AscentType): string => {
  if (t.kind === 'List') {
    return `List<${typeToString(t.elem)}>`;
  }
  if (t.kind === 'Optional') {
    return `${typeToString(t.elem)}?`;
  }
  return t.kind;
};

// design.md §4's "Scalars" heading: Int, Float, Bool, String — every type
// with one obvious, total way to show as text. Used to let a '${ }'
// interpolation hole (§4/§6) accept these without an explicit '.toString()'
// call; a hardcoded rule until a Show-style trait (§7) can express it as
// ordinary dispatch instead.
export const isScalarType = (t: AscentType): boolean =>
  t.kind === 'Int' || t.kind === 'Float' || t.kind === 'Bool' || t.kind === 'String';

// agenda/typechecker-refactor.md Phase 5: true for the checker-internal
// Invalid tombstone — a sub-expression whose own type-checking already
// failed and reported its diagnostic there. Never written in source, never
// shown in a message; callers use this to skip checks that Invalid itself
// would poison, without a second, cascaded diagnostic.
export const isInvalidType = (t: AscentType): boolean => t.kind === 'Invalid';

// True when 'Never' appears anywhere in t's structure — catches not just a
// bare '[]' but anything built from one with no widening context
// ('[].reverse()', '[[]]', …), since all of those freeze the same way once a
// slot's type is fixed (design.md §7).
export const containsNever = (t: AscentType): boolean => {
  if (t.kind === 'Never') return true;
  if (t.kind === 'List' || t.kind === 'Optional') return containsNever(t.elem);
  return false;
};

export const typesEqual = (a: AscentType, b: AscentType): boolean => {
  if (a.kind !== b.kind) {
    return false;
  }

  if (a.kind === 'List' && b.kind === 'List') {
    return typesEqual(a.elem, b.elem);
  }

  if (a.kind === 'Optional' && b.kind === 'Optional') {
    return typesEqual(a.elem, b.elem);
  }

  return true;
};

// A coercion is the runtime witness of a subtyping edge: how to turn a value
// of the sub-type into one of the super-type. `null` means the two types are
// equal — no runtime conversion needed.
export type Coercion = 'intToFloat' | { elem: Coercion } | null;

// S <: T — the one place widening is defined. `Never` widens to *any* T
// (design.md §7 — it's uninhabited, so the edge is vacuously sound: there's
// never actually a Never value to convert, so `null` is a safe placeholder
// witness regardless of what T turns out to be). Int widens to Float, lists
// widen covariantly (sound only because Ascent lists are immutable: append /
// prepend / concat return new lists rather than mutating in place), and — the
// other hard-coded widening rule design.md §7 calls out — a non-null T widens
// to T?: a bare value needs no runtime change to become "present" (there's no
// Some(...) wrapper, design.md §4), and None widens to T? for any T since it's
// already the Optional's absent case. Both reuse whatever coercion the inner
// types need (e.g. Int widening into Float? still yields 'intToFloat'), never
// a nested { elem: … } witness — unlike List, an Optional value is never
// wrapped, so the coercion applies straight to the raw value at runtime.
// Returns the coercion that witnesses the edge, or `false` when S is not a
// subtype of T.
export const subtype = (sub: AscentType, sup: AscentType): Coercion | false => {
  // Invalid absorbs both directions (agenda/typechecker-refactor.md Phase 5): it's
  // assignable to every type and every type is assignable to it, so a value
  // that already failed to check satisfies whatever expectation meets it
  // next without a second diagnostic. `null` is a safe placeholder witness
  // here — this coercion must never actually run (Rule 4: a tree containing
  // Invalid never reaches execution).
  if (sub.kind === 'Invalid' || sup.kind === 'Invalid') {
    return null;
  }

  if (typesEqual(sub, sup)) {
    return null;
  }

  if (sub.kind === 'Never') {
    return null;
  }

  if (sub.kind === 'Int' && sup.kind === 'Float') {
    return 'intToFloat';
  }

  if (sub.kind === 'List' && sup.kind === 'List') {
    const c = subtype(sub.elem, sup.elem);
    return c === false ? false : { elem: c };
  }

  if (sup.kind === 'Optional') {
    if (sub.kind === 'None') return null;
    const subElem = sub.kind === 'Optional' ? sub.elem : sub;
    return subtype(subElem, sup.elem);
  }

  return false;
};

// The least common supertype — derived from subtyping. When one side
// subtypes the other, that supertype is the join. Otherwise, for two lists
// whose elements aren't directly related by subtyping, recurse on the
// elements (structural join; doesn't add any widening knowledge of its own).
// Returns null when the two types have no common supertype.
export const leastCommonType = (a: AscentType, b: AscentType): AscentType | null => {
  // Checked explicitly (rather than left to fall out of subtype() below) so
  // the join is Invalid regardless of which side it's on — subtype()'s
  // absorption alone would make the *first* subtype(a, b) check succeed and
  // return `b` even when only `a` is Invalid, silently discarding the
  // failure instead of propagating it (agenda/typechecker-refactor.md Phase 5).
  if (a.kind === 'Invalid' || b.kind === 'Invalid') {
    return INVALID_TYPE;
  }

  if (subtype(a, b) !== false) {
    return b;
  }

  if (subtype(b, a) !== false) {
    return a;
  }

  if (a.kind === 'List' && b.kind === 'List') {
    const elem = leastCommonType(a.elem, b.elem);
    return elem !== null ? listOfType(elem) : null;
  }
  return null;
};

// `from` is assignable to `to` exactly when it's a subtype of `to`.
export const isAssignableTo = (from: AscentType, to: AscentType): boolean => subtype(from, to) !== false;
