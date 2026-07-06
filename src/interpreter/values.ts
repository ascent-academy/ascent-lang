import { subtype, type AscentType, type Coercion } from '../types/types.js';

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
  // A half-open Int range (design.md §4). Stores its bounds as bigints (the
  // Int representation), not a materialized list — iterating walks lo→hi
  // lazily, so '0..1000000' costs nothing until asked for its items.
  | { type: 'Range'; lo: bigint; hi: bigint }
  | { type: 'None' }
  | { type: 'Done' }
);

// Per-type narrowings, so a builtin impl keyed under 'Int' can take an
// already-narrowed receiver (`r.value` is a bigint) without re-checking.
export type IntValue = Extract<RuntimeValue, { type: 'Int' }>;
export type FloatValue = Extract<RuntimeValue, { type: 'Float' }>;
export type StringValue = Extract<RuntimeValue, { type: 'String' }>;
export type ListValue = Extract<RuntimeValue, { type: 'List' }>;
export type RangeValue = Extract<RuntimeValue, { type: 'Range' }>;

// Thin value constructors — the runtime twin of INT_TYPE etc. on the type
// side, so the evaluator and the builtin table stop repeating
// `{ type: 'Int', value: … }` literals. None/Done carry no data, so they're
// shared singletons.
export const intVal = (value: bigint) => ({ type: 'Int' as const, value });
export const floatVal = (value: number) => ({ type: 'Float' as const, value });
export const strVal = (value: string) => ({ type: 'String' as const, value });
export const boolVal = (value: boolean) => ({ type: 'Bool' as const, value });
export const rangeVal = (lo: bigint, hi: bigint) => ({ type: 'Range' as const, lo, hi });
export const NONE = { type: 'None' as const };
export const DONE = { type: 'Done' as const };

// Apply the runtime witness `subtype` produced (types/types.ts's Coercion) to
// a value. Recurses into lists, so a nested widening — List<List<Int>> <:
// List<List<Float>> — is one call rather than element recursion re-rolled by
// hand at every level. `null` (equal types, or Never/Invalid's vacuous edge)
// is a no-op; 'intToFloat' promotes the one scalar widening; `{ elem }` maps
// the inner witness over a List's elements. It is the sole reason a value ever
// changes shape at runtime.
export const applyCoercion = (v: RuntimeValue, c: Coercion): RuntimeValue => {
  if (c === null) return v;
  if (c === 'intToFloat') return floatVal(Number((v as Extract<RuntimeValue, { type: 'Int' }>).value));
  const list = v as Extract<RuntimeValue, { type: 'List' }>;
  return { type: 'List', elements: list.elements.map(e => applyCoercion(e, c.elem)) };
};

// Coerce a runtime value of static type `from` into one of type `to`, per the
// witness `subtype` produces. The checker has already proven `from <: to` at
// every call site (the checker never emits a coercion it didn't first prove),
// so the witness is never `false`; `|| null` collapses that impossible case to
// a no-op instead of throwing. All conversions other than these subtyping
// edges are explicit (methods like toFloat/toInt).
export const coerce = (v: RuntimeValue, from: AscentType, to: AscentType): RuntimeValue =>
  applyCoercion(v, subtype(from, to) || null);

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
  // Two ranges are equal when they carry the same bounds — structural, like
  // every other '==' (design.md §5). (Distinct empty ranges, e.g. '5..5' and
  // '3..3', are thus unequal: different bounds, not "both empty".)
  if (left.type === 'Range' && right.type === 'Range') return left.lo === right.lo && left.hi === right.hi;
  return true; // None, Done — singleton types
};
