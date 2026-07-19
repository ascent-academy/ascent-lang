import type { Span } from '../lexer/token.js';
import type { AscentType } from '../types/types.js';
import { RuntimeError } from '../errors/runtime-error.js';
import {
  coerce, formatFloat, graphemesOf, scalarToString,
  intVal, floatVal, strVal, boolVal, NONE,
  type RuntimeValue, type IntValue, type FloatValue, type BoolValue, type StringValue, type ListValue, type RangeValue,
} from './values.js';
import { checkIntOverflow } from './arithmetic.js';
import { valueToString } from '../parser/printer.js';
import { tryParseInt, tryParseFloat, tryParseBool } from '../scalar-input.js';

// ---- Built-in methods: data, not control flow -----------------------
//
// The runtime peer of check/signatures.ts's METHODS table. Keyed identically —
// receiver type kind, then method name — but holding the *implementation* of
// each builtin rather than its *signature*. "What a method does" is data that
// grows whenever a builtin is added; dispatch is the one lookup-and-apply rule
// below (evalMethodCall), not a switch per type.
//
// The checker has already guaranteed receiver type, method name, and arity
// before a call reaches here (synth's methodCall bails to Invalid otherwise,
// exactly as signatures.ts relies on), so every lookup is total by
// construction and the impls never re-validate. The two tables are kept from
// drifting by a parity meta-test (test/builtins-parity.test.ts): every METHODS
// key must have a METHOD_IMPLS entry and vice-versa.

// Everything an impl needs beyond its receiver and evaluated args: the call
// span (for the R#### crashes a few methods raise) and the static types the
// List methods coerce their elements against when the result widens
// (design.md §7 — see coerce below).
export type MethodCtx = {
  span: Span;
  receiverType: AscentType;
  argTypes: AscentType[];
  resultType: AscentType;
};

// The receiver arrives narrowed to R: the dispatcher only ever calls an entry
// under the key that matches its receiver's runtime type.
type MethodImpl<R extends RuntimeValue = RuntimeValue> =
  (recv: R, args: RuntimeValue[], ctx: MethodCtx) => RuntimeValue;

const INT_IMPLS: Record<string, MethodImpl<IntValue>> = {
  // `r` is annotated here (and on Float.toString) only because the key
  // 'toString' collides with Object.prototype.toString's `() => string`, which
  // hijacks the contextual type; every other entry infers `r` from the group.
  toString: (r: IntValue) => strVal(String(r.value)),
  toFloat: r => floatVal(Number(r.value)),
  // abs(INT_MIN) has no representable Int result (its magnitude is one past
  // INT_MAX) — the classic two's-complement overflow case.
  abs: (r, _args, { span }) => intVal(checkIntOverflow(r.value < 0n ? -r.value : r.value, span)),
};

// stdlib/scalars.md: a Float has no bare '.toInt()' — losing the fractional
// part is a decision the caller must name, so each rounding rule is its own
// method rather than one hidden choice. All four always succeed (a finite
// Float always rounds), so only checkIntOverflow guards the Int result.
const roundHalfAwayFromZero = (n: number): number => Math.sign(n) * Math.round(Math.abs(n));

const FLOAT_IMPLS: Record<string, MethodImpl<FloatValue>> = {
  toString: (r: FloatValue) => strVal(formatFloat(r.value)),
  trunc: (r, _args, { span }) => intVal(checkIntOverflow(BigInt(Math.trunc(r.value)), span)),
  round: (r, _args, { span }) => intVal(checkIntOverflow(BigInt(roundHalfAwayFromZero(r.value)), span)),
  floor: (r, _args, { span }) => intVal(checkIntOverflow(BigInt(Math.floor(r.value)), span)),
  ceil: (r, _args, { span }) => intVal(checkIntOverflow(BigInt(Math.ceil(r.value)), span)),
  abs: r => floatVal(Math.abs(r.value)),
};

// toString is the same canonical Display form '${}'/print use (scalarToString),
// shared here rather than reimplemented — 'True'/'False', matching the literal
// spelling (design.md §4).
const BOOL_IMPLS: Record<string, MethodImpl<BoolValue>> = {
  toString: (r: BoolValue) => strVal(scalarToString(r)),
};

// design.md §4/§9: no integer indexing on String — first/last/slice work in
// graphemes and crash (bug tier, like list '[ ]') rather than lie about what
// they return, exactly the reasoning that already governs List indexing.
const STRING_IMPLS: Record<string, MethodImpl<StringValue>> = {
  length: r => intVal(BigInt(graphemesOf(r.value).length)),
  first: r => {
    // design.md §4: returns String? — None on an empty String, never a crash,
    // since an empty receiver is an expected case here, not a bug.
    const chars = graphemesOf(r.value);
    return chars.length === 0 ? NONE : strVal(chars[0]!);
  },
  last: r => {
    const chars = graphemesOf(r.value);
    return chars.length === 0 ? NONE : strVal(chars[chars.length - 1]!);
  },
  chars: r => ({ type: 'List', elements: graphemesOf(r.value).map((c): RuntimeValue => strVal(c)) }),
  slice: (r, args, { span }) => {
    // design.md §4: slice takes one Range; its bounds are the start (low)
    // and end (high, exclusive) of the substring.
    const range = args[0] as RangeValue;
    const chars = graphemesOf(r.value);
    const start = Number(range.lo);
    const end = Number(range.hi);
    if (start < 0 || end > chars.length || start > end) {
      throw new RuntimeError({
        code: 'R0006', span,
        data: { start: String(start), end: String(end), length: String(chars.length) },
      });
    }
    return strVal(chars.slice(start, end).join(''));
  },
  repeat: (r, args, { span }) => {
    const count = (args[0] as IntValue).value;
    if (count < 0n) {
      throw new RuntimeError({ code: 'R0007', span, data: { count: String(count) } });
    }
    return strVal(r.value.repeat(Number(count)));
  },
  trim: r => strVal(r.value.trim()),
  padLeft: (r, args) => {
    const target = Number((args[0] as IntValue).value);
    const padCount = Math.max(0, target - graphemesOf(r.value).length);
    return strVal(' '.repeat(padCount) + r.value);
  },
  // stdlib/scalars.md: parsing a String can fail, so each returns T? (None on
  // a bad parse) rather than crashing. Reuses scalar-input.ts's tryParse*,
  // the same validation the prompt family's ask*/CLI '--flag' parsing already
  // apply — one rule for "does this String name a value", not three.
  toInt: r => {
    const parsed = tryParseInt(r.value);
    return parsed === null ? NONE : intVal(parsed);
  },
  toFloat: r => {
    const parsed = tryParseFloat(r.value);
    return parsed === null ? NONE : floatVal(parsed);
  },
  toBool: r => {
    const parsed = tryParseBool(r.value);
    return parsed === null ? NONE : boolVal(parsed);
  },
};

// The element type of a List type, or null when it isn't a List
// (length/isEmpty return Int/Bool). `widen` coerces one element from its own
// static type to the result's; a null on either side means "no widening", so
// the element passes straight through. A List-returning method widens every
// element to the result element type (design.md §7) — the receiver's own, and
// any coming from an argument, each by its own static edge (e.g.
// List<Float>.concat(List<Int>) widens the argument, not the receiver).
const elemTypeOf = (t: AscentType): AscentType | null => (t.kind === 'List' ? t.elem : null);
const widen = (v: RuntimeValue, from: AscentType | null, to: AscentType | null): RuntimeValue =>
  from !== null && to !== null ? coerce(v, from, to) : v;
const widenAll = (vs: RuntimeValue[], from: AscentType | null, to: AscentType | null): RuntimeValue[] =>
  vs.map(v => widen(v, from, to));

const LIST_IMPLS: Record<string, MethodImpl<ListValue>> = {
  length: r => intVal(BigInt(r.elements.length)),
  isEmpty: r => boolVal(r.elements.length === 0),
  reverse: (r, _args, ctx) => ({
    type: 'List',
    elements: widenAll([...r.elements].reverse(), elemTypeOf(ctx.receiverType), elemTypeOf(ctx.resultType)),
  }),
  append: (r, args, ctx) => {
    const toElem = elemTypeOf(ctx.resultType);
    return {
      type: 'List',
      elements: [...widenAll(r.elements, elemTypeOf(ctx.receiverType), toElem), widen(args[0]!, ctx.argTypes[0]!, toElem)],
    };
  },
  prepend: (r, args, ctx) => {
    const toElem = elemTypeOf(ctx.resultType);
    return {
      type: 'List',
      elements: [widen(args[0]!, ctx.argTypes[0]!, toElem), ...widenAll(r.elements, elemTypeOf(ctx.receiverType), toElem)],
    };
  },
  concat: (r, args, ctx) => {
    const toElem = elemTypeOf(ctx.resultType);
    const other = args[0] as ListValue;
    return {
      type: 'List',
      elements: [
        ...widenAll(r.elements, elemTypeOf(ctx.receiverType), toElem),
        ...widenAll(other.elements, elemTypeOf(ctx.argTypes[0]!), toElem),
      ],
    };
  },
};

// design.md §4: a Range is Int-only and half-open. length/toList/contains
// read its stored bounds directly — an empty range (lo >= hi) has length 0,
// an empty toList, and contains nothing.
const RANGE_IMPLS: Record<string, MethodImpl<RangeValue>> = {
  length: r => intVal(r.hi > r.lo ? r.hi - r.lo : 0n),
  toList: r => {
    const elements: RuntimeValue[] = [];
    for (let i = r.lo; i < r.hi; i++) elements.push(intVal(i));
    return { type: 'List', elements };
  },
  contains: (r, args) => {
    const x = (args[0] as IntValue).value;
    return boolVal(r.lo <= x && x < r.hi);
  },
};

// Each group is written with its receiver narrowed (IntValue, ListValue, …);
// the cast to the erased MethodImpl is sound because evalMethodCall only
// invokes METHOD_IMPLS[receiver.type], so the receiver always matches the key.
export const METHOD_IMPLS: Partial<Record<RuntimeValue['type'], Record<string, MethodImpl>>> = {
  Int: INT_IMPLS as Record<string, MethodImpl>,
  Float: FLOAT_IMPLS as Record<string, MethodImpl>,
  Bool: BOOL_IMPLS as Record<string, MethodImpl>,
  String: STRING_IMPLS as Record<string, MethodImpl>,
  List: LIST_IMPLS as Record<string, MethodImpl>,
  Range: RANGE_IMPLS as Record<string, MethodImpl>,
};

// '.orAbort(msg?)' unwraps a Result/Optional's good case or crashes on its bad
// one (whitepaper §9). It dispatches on the *static* box type in ctx, not the
// receiver's runtime type: a Result is a Success/Failure Record, and a present
// Optional is just its bare value, so neither has a METHOD_IMPLS key — and an
// 'Optional<T orfail E>' whose present value is itself a Failure must not be
// mistaken for a failed Result, which is exactly why the static kind decides.
// The optional message augments the crash (parenthesized), never replaces it.
const evalOrAbort = (receiver: RuntimeValue, args: RuntimeValue[], ctx: MethodCtx): RuntimeValue => {
  const message = args.length === 1 ? (args[0] as StringValue).value : null;
  const context = message === null ? '' : ` (${message})`;

  if (ctx.receiverType.kind === 'Optional') {
    // A present Optional is already the bare value (no wrapper, §4); only None
    // has nothing to unwrap, so it aborts (R0010).
    if (receiver.type === 'None') {
      throw new RuntimeError({ code: 'R0010', span: ctx.span, data: { context } });
    }
    return receiver;
  }
  // Result: a Success unwraps to its 'value'; a Failure aborts, reporting the
  // carried error — the most informative thing there is (R0009).
  const rec = receiver as Extract<RuntimeValue, { type: 'Record' }>;
  if (rec.name === 'Failure') {
    throw new RuntimeError({
      code: 'R0009', span: ctx.span,
      data: { error: valueToString(rec.fields.get('error')!), context },
    });
  }
  return rec.fields.get('value')!;
};

// The one lookup-and-apply rule. Both lookups are total by construction (the
// checker proved the receiver has this method), so a miss is an internal
// invariant violation, not a user error.
export const evalMethodCall = (
  receiver: RuntimeValue, method: string, args: RuntimeValue[], ctx: MethodCtx,
): RuntimeValue => {
  // orAbort is the one method not in METHOD_IMPLS — it's polymorphic over
  // Result/Optional, whose runtime values carry no distinguishing type, so it
  // dispatches on the static receiver type instead (see evalOrAbort).
  if (method === 'orAbort' && (ctx.receiverType.kind === 'Result' || ctx.receiverType.kind === 'Optional')) {
    return evalOrAbort(receiver, args, ctx);
  }
  const impls = METHOD_IMPLS[receiver.type];
  if (impls === undefined) throw new Error(`internal: ${receiver.type} has no methods`);
  const impl = impls[method];
  if (impl === undefined) throw new Error(`internal: ${receiver.type} has no method '${method}'`);
  return impl(receiver, args, ctx);
};
