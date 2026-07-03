export type Type =
  | { kind: 'Int' }
  | { kind: 'Float' }
  | { kind: 'Bool' }
  | { kind: 'String' }
  | { kind: 'None' }
  | { kind: 'Done' }
  | { kind: 'List'; elem: Type };

export const INT: Type = { kind: 'Int' };
export const FLOAT: Type = { kind: 'Float' };
export const BOOL: Type = { kind: 'Bool' };
export const STRING: Type = { kind: 'String' };
export const NONE: Type = { kind: 'None' };
export const DONE: Type = { kind: 'Done' };
export const listOf = (elem: Type): Type => ({ kind: 'List', elem });

export const typeToString = (t: Type): string => {
  if (t.kind === 'List') return `List<${typeToString(t.elem)}>`;
  return t.kind;
};

export const typesEqual = (a: Type, b: Type): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'List' && b.kind === 'List') return typesEqual(a.elem, b.elem);
  return true;
};

// Int widens to Float everywhere — the only implicit numeric promotion.
// List<Int> widens to List<Float> via the same rule applied recursively.
// Returns null when the two types have no common supertype.
export const leastCommonType = (a: Type, b: Type): Type | null => {
  if (typesEqual(a, b)) return a;
  if (a.kind === 'Int' && b.kind === 'Float') return FLOAT;
  if (a.kind === 'Float' && b.kind === 'Int') return FLOAT;
  if (a.kind === 'List' && b.kind === 'List') {
    const elem = leastCommonType(a.elem, b.elem);
    return elem !== null ? listOf(elem) : null;
  }
  return null;
};

// `from` is assignable to `to` when their LCT is exactly `to`
// (i.e., `from` fits inside `to`, possibly by widening).
export const isAssignableTo = (from: Type, to: Type): boolean => {
  const lct = leastCommonType(from, to);
  return lct !== null && typesEqual(lct, to);
};
