import type { Span } from '../lexer/token.js';
import type { AscentType } from '../types/types.js';
import { RuntimeError } from '../errors/runtime-error.js';
import type { Environment } from './env.js';
import {
  coerce, asFloat, valuesEqual, intVal, floatVal, strVal, recordVal, DONE,
  type RuntimeValue, type Numeric, type FloatValue, type StringValue,
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

// ---- Stdlib module registry: ASYNC implementations ---------------------
//
// The runtime peer of check/stdlib.ts's ASYNC_MODULE_SIGS — kept separate
// from ModuleFnImpl above because an async export's "work" is a real Host
// capability call (fs.readLines), which needs the Environment to reach it
// (env.fs()), not just the already-evaluated args a sync export gets.
export type AsyncModuleFnCtx = { span: Span; env: Environment };
type AsyncModuleFnImpl = (args: RuntimeValue[], ctx: AsyncModuleFnCtx) => Promise<RuntimeValue>;

const FS_IMPLS: Record<string, AsyncModuleFnImpl> = {
  readLines: async (args, ctx) => {
    const fs = ctx.env.fs();
    if (fs === undefined) throw new RuntimeError({ code: 'R0014', span: ctx.span });
    const path = (args[0] as StringValue).value;
    const result = await fs.readLines(path);
    // A read failure is data, not a crash (whitepaper §9) — built directly as
    // the Success/Failure record 'readLines(path): List<String> orfail String'
    // promises, the same shape a 'Success{…}'/'Failure{…}' construction in
    // Ascent source would produce.
    if (!result.ok) return recordVal('Failure', new Map([['error', strVal(result.error)]]));
    const lines: RuntimeValue = { type: 'List', elements: result.value.map(strVal) };
    return recordVal('Success', new Map([['value', lines]]));
  },
};

export const ASYNC_MODULE_IMPLS: Record<string, Record<string, AsyncModuleFnImpl>> = {
  fs: FS_IMPLS,
};

// The async twin of evalModuleCall — same total-by-construction lookup.
export const evalAsyncModuleCall = async (
  module: string, name: string, args: RuntimeValue[], ctx: AsyncModuleFnCtx,
): Promise<RuntimeValue> => {
  const impl = ASYNC_MODULE_IMPLS[module]?.[name];
  if (impl === undefined) throw new Error(`internal: no async stdlib impl for '${module}.${name}'`);
  return impl(args, ctx);
};
