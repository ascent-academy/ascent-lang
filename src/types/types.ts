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

export const typesEqual = (a: AscentType, b: AscentType): boolean => {
  if (a.kind !== b.kind) {
    return false;
  }

  if (a.kind === 'List' && b.kind === 'List') {
    return typesEqual(a.elem, b.elem);
  }

  return true;
};

// Int widens to Float everywhere — the only implicit numeric promotion.
// List<Int> widens to List<Float> via the same rule applied recursively.
// Returns null when the two types have no common supertype.
export const leastCommonType = (a: AscentType, b: AscentType): AscentType | null => {
  if (typesEqual(a, b)) {
    return a;
  }

  if (a.kind === 'Int' && b.kind === 'Float') {
    return FLOAT_TYPE;
  }

  if (a.kind === 'Float' && b.kind === 'Int') {
    return FLOAT_TYPE;
  }

  if (a.kind === 'List' && b.kind === 'List') {
    const elem = leastCommonType(a.elem, b.elem);
    return elem !== null ? listOfType(elem) : null;
  }
  return null;
};

// `from` is assignable to `to` when their LCT is exactly `to`
// (i.e., `from` fits inside `to`, possibly by widening).
export const isAssignableTo = (from: AscentType, to: AscentType): boolean => {
  const lct = leastCommonType(from, to);
  return lct !== null && typesEqual(lct, to);
};
