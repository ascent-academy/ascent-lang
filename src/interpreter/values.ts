import { INT_TYPE, subtype, type AscentType } from '../types/types.js';

// The runtime value domain — the interpreter's twin of types/types.ts's
// AscentType. Everything here operates on a RuntimeValue independent of the
// tree walk: constructors, coercion, equality, and display.

export type ScalarValue = (
  | { type: 'Int'; value: bigint }
  | { type: 'Float'; value: number }
  | { type: 'Bool'; value: boolean }
  | { type: 'String'; value: string }
);

export type RuntimeValue = (
  | ScalarValue
  | { type: 'List'; elements: RuntimeValue[] }
  | { type: 'None' }
  | { type: 'Done' }
);

// Thin value constructors — the runtime twin of INT_TYPE etc. on the type
// side, so the evaluator and the builtin table stop repeating
// `{ type: 'Int', value: … }` literals. None/Done carry no data, so they're
// shared singletons.
export const intVal = (value: bigint) => ({ type: 'Int' as const, value });
export const floatVal = (value: number) => ({ type: 'Float' as const, value });
export const strVal = (value: string) => ({ type: 'String' as const, value });
export const boolVal = (value: boolean) => ({ type: 'Bool' as const, value });
export const NONE = { type: 'None' as const };
export const DONE = { type: 'Done' as const };

// Coerce a runtime value to match a target type, per the witness `subtype`
// produces — currently only Int <: Float, so only an Int value ever moves.
// All other type conversions are explicit (methods like toFloat/toInt).
export const coerce = (v: RuntimeValue, targetType: AscentType): RuntimeValue => {
  if (v.type === 'Int' && subtype(INT_TYPE, targetType) === 'intToFloat') {
    return floatVal(Number(v.value));
  }
  return v;
};

// Float's canonical string form always shows the decimal point, so a whole
// number stays visibly a Float (`3.0`, never collapsed to `3` like an Int).
export const formatFloat = (value: number): string => {
  const s = String(value);
  return /[.e]/i.test(s) ? s : `${s}.0`;
};

// How a scalar shows as text inside a '${ }' hole — hardcoded until a
// Show-style trait exists (see isScalarType in types/types.ts, which the
// typechecker uses to guarantee `v` is one of these four cases here). Mirrors
// Int/Float's own '.toString()' method exactly, so writing it explicitly in a
// hole is redundant, never different.
export const scalarToString = (v: RuntimeValue): string => {
  switch (v.type) {
    case 'Int': return String(v.value);
    case 'Float': return formatFloat(v.value);
    case 'Bool': return v.value ? 'True' : 'False';
    case 'String': return v.value;
    default: throw new Error(`internal: ${v.type} in an interpolation hole (typechecker should have rejected it)`);
  }
};

// String's grapheme (Unicode "user-perceived character") segmentation —
// design.md §4's basis for length/first/last/chars/slice, so `"é".length()`
// is 1 even when the underlying code points are 'e' + a combining accent.
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemesOf = (s: string): string[] => Array.from(graphemeSegmenter.segment(s), seg => seg.segment);

// ---- Equality -------------------------------------------------------

export type Numeric = { type: 'Int'; value: bigint } | { type: 'Float'; value: number };
export const isNumeric = (v: RuntimeValue): v is Numeric => v.type === 'Int' || v.type === 'Float';
export const asFloat = (v: Numeric): number => (v.type === 'Int' ? Number(v.value) : v.value);

// '==' / '!=' are structural — same-type values compare by their
// contents — except Int meeting Float, which compares as numbers (the
// same one-way promotion arithmetic uses). Two Ints compare exactly, as
// BigInts, rather than going through asFloat and risking the precision
// loss a huge Int would suffer converting to a JS number.
export const valuesEqual = (left: RuntimeValue, right: RuntimeValue): boolean => {
  if (isNumeric(left) && isNumeric(right)) {
    return left.type === 'Int' && right.type === 'Int'
      ? left.value === right.value
      : asFloat(left) === asFloat(right);
  }
  if (left.type !== right.type) return false;
  if (left.type === 'Bool' && right.type === 'Bool') return left.value === right.value;
  if (left.type === 'String' && right.type === 'String') return left.value === right.value;
  return true; // None, Done — singleton types
};
