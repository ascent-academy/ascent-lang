import type { Span } from '../lexer/token.js';
import type { AscentType } from '../types/types.js';
import { RuntimeError } from '../errors/runtime-error.js';
import {
  coerce, asFloat, valuesEqual, intVal, floatVal, DONE,
  type RuntimeValue, type Numeric, type FloatValue,
} from './values.js';
import { checkFiniteFloat, checkIntOverflow } from './arithmetic.js';
import { valueToString } from '../parser/printer.js';

// ---- Stdlib module registry: implementations --------------------------
//
// The runtime peer of check/stdlib.ts's MODULE_SIGS. Keyed identically — module
// name, then export name — holding each stdlib function's behaviour. The checker
// has already proven the module, export, arity, and argument types before a call
// reaches here (an unknown one was reported at the import, a bad argument at the
// call), so every lookup is total and the impls never re-validate types; they
// only guard the genuinely runtime failures a type can't rule out (sqrt of a
// negative → non-real, a false assertion).
//
// A parity meta-test (test/stdlib-parity.test.ts) pins these keys to MODULE_SIGS's,
// so adding a stdlib function means adding it under the same key in both files, or
// a red test — the same discipline as METHODS/METHOD_IMPLS.

export interface ModuleFnCtx {
  argTypes: AscentType[];
  resultType: AscentType;
  span: Span;
}
type ModuleFnImpl = (args: RuntimeValue[], ctx: ModuleFnCtx) => RuntimeValue;

// Order two comparable values that already share a type (both coerced to the
// join): -1 / 0 / 1, by BigInt for Int (exact, no precision loss on huge values),
// by number for Float, lexicographically for String — the orderings '<'/'>' use.
const compareValues = (a: RuntimeValue, b: RuntimeValue): number => {
  if (a.type === 'Int' && b.type === 'Int') return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  if (a.type === 'String' && b.type === 'String') return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  const l = asFloat(a as Numeric), r = asFloat(b as Numeric);
  return l < r ? -1 : l > r ? 1 : 0;
};

const minMax = (keepLeft: (cmp: number) => boolean): ModuleFnImpl => (args, ctx) => {
  // Coerce both to the join (the result type) so the comparison — and the value
  // handed back — are one type (min(2, 3.5) returns the Float 2.0, not the Int 2).
  const a = coerce(args[0]!, ctx.argTypes[0]!, ctx.resultType);
  const b = coerce(args[1]!, ctx.argTypes[1]!, ctx.resultType);
  return keepLeft(compareValues(a, b)) ? a : b;
};

// Round a Float to an Int via `f`, trapping overflow (a huge Float has no Int).
// An Int argument is already whole, so it passes through unchanged — never a
// lossy round trip through Float that would corrupt a large magnitude.
const roundWith = (f: (x: number) => number): ModuleFnImpl => (args, ctx) => {
  const v = args[0]!;
  if (v.type === 'Int') return v;
  return intVal(checkIntOverflow(BigInt(f((v as FloatValue).value)), ctx.span));
};

const MATH_IMPLS: Record<string, ModuleFnImpl> = {
  min: minMax(cmp => cmp <= 0),
  max: minMax(cmp => cmp >= 0),
  // sqrt of a negative is NaN, which Ascent forbids as a value (§4), so it trips
  // the same non-real-Float crash (R0004) any NaN-producing step does.
  sqrt: (args, ctx) => floatVal(checkFiniteFloat(Math.sqrt(asFloat(args[0]! as Numeric)), ctx.span)),
  floor: roundWith(Math.floor),
  ceil: roundWith(Math.ceil),
  round: roundWith(Math.round),
};

const ASSERT_IMPLS: Record<string, ModuleFnImpl> = {
  assert: (args, ctx) => {
    if (!(args[0]! as Extract<RuntimeValue, { type: 'Bool' }>).value) {
      throw new RuntimeError({ code: 'R0011', span: ctx.span });
    }
    return DONE;
  },
  assertEqual: (args, ctx) => {
    if (!valuesEqual(args[0]!, args[1]!)) {
      throw new RuntimeError({
        code: 'R0012', span: ctx.span,
        data: { left: valueToString(args[0]!), right: valueToString(args[1]!) },
      });
    }
    return DONE;
  },
};

export const MODULE_IMPLS: Record<string, Record<string, ModuleFnImpl>> = {
  math: MATH_IMPLS,
  assert: ASSERT_IMPLS,
};

// The one lookup-and-apply rule (the runtime twin of moduleCallType). The lookup
// is total by construction — the checker resolved the module and export — so a
// miss is an internal invariant violation.
export const evalModuleCall = (
  module: string, name: string, args: RuntimeValue[], ctx: ModuleFnCtx,
): RuntimeValue => {
  const impl = MODULE_IMPLS[module]?.[name];
  if (impl === undefined) throw new Error(`internal: no stdlib impl for '${module}.${name}'`);
  return impl(args, ctx);
};
