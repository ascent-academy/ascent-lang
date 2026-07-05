export type AscentType =
  | { kind: 'Int' }
  | { kind: 'Float' }
  | { kind: 'Bool' }
  | { kind: 'String' }
  | { kind: 'None' }
  | { kind: 'Done' }
  | { kind: 'List'; elem: AscentType };

export const INT_TYPE: AscentType = { kind: 'Int' };
export const FLOAT_TYPE: AscentType = { kind: 'Float' };
export const BOOL_TYPE: AscentType = { kind: 'Bool' };
export const STRING_TYPE: AscentType = { kind: 'String' };
export const NONE_TYPE: AscentType = { kind: 'None' };
export const DONE_TYPE: AscentType = { kind: 'Done' };
export const listOfType = (elem: AscentType): AscentType => ({ kind: 'List', elem });

export const typeToString = (t: AscentType): string => {
  if (t.kind === 'List') {
    return `List<${typeToString(t.elem)}>`;
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

export const typesEqual = (a: AscentType, b: AscentType): boolean => {
  if (a.kind !== b.kind) {
    return false;
  }

  if (a.kind === 'List' && b.kind === 'List') {
    return typesEqual(a.elem, b.elem);
  }

  return true;
};

// A coercion is the runtime witness of a subtyping edge: how to turn a value
// of the sub-type into one of the super-type. `null` means the two types are
// equal — no runtime conversion needed.
export type Coercion = 'intToFloat' | { elem: Coercion } | null;

// S <: T — the one place widening is defined. Int widens to Float, and lists
// widen covariantly (sound only because Ascent lists are immutable: append /
// prepend / concat return new lists rather than mutating in place). Returns
// the coercion that witnesses the edge, or `false` when S is not a subtype of T.
export const subtype = (sub: AscentType, sup: AscentType): Coercion | false => {
  if (typesEqual(sub, sup)) {
    return null;
  }

  if (sub.kind === 'Int' && sup.kind === 'Float') {
    return 'intToFloat';
  }

  if (sub.kind === 'List' && sup.kind === 'List') {
    const c = subtype(sub.elem, sup.elem);
    return c === false ? false : { elem: c };
  }

  return false;
};

// The least common supertype — derived from subtyping. When one side
// subtypes the other, that supertype is the join. Otherwise, for two lists
// whose elements aren't directly related by subtyping, recurse on the
// elements (structural join; doesn't add any widening knowledge of its own).
// Returns null when the two types have no common supertype.
export const leastCommonType = (a: AscentType, b: AscentType): AscentType | null => {
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
