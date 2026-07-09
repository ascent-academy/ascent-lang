import type { Span } from '../lexer/token.js';
import {
  AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, DONE_TYPE, INVALID_TYPE,
  leastCommonType, isAssignableTo, typeToString,
} from '../types/types.js';
import { Diagnostics, requireArity, typeMismatch } from './diagnostics.js';
import { satisfies } from './traits.js';

// ---- Stdlib module registry: signatures -------------------------------
//
// The checker half of the compiler-known standard library (whitepaper §10).
// Each module maps an export name to its signature — a resolver that checks the
// argument types and yields the result type, the same shape the List methods
// keep (a fixed result won't do for min/max, whose result is the *join* of its
// arguments). The runtime half — MODULE_IMPLS in interpreter/stdlib.ts — is
// keyed identically and pinned in sync by a parity meta-test, exactly like the
// METHODS/METHOD_IMPLS pair (the "builtins two-table" decision). Growing the
// stdlib is adding an entry here and its impl there, never new control flow.

export interface ModuleFnSig {
  arity: number;
  resolve: (args: AscentType[], diagnostics: Diagnostics, span: Span) => AscentType;
}

// A one-argument numeric function: the argument must be an Int or Float (an Int
// promotes), and `result` is the fixed result type (Float for sqrt, Int for the
// rounding trio, which yield whole numbers).
const numeric1 = (result: AscentType): ModuleFnSig => ({
  arity: 1,
  resolve: (args, diagnostics, span) =>
    isAssignableTo(args[0]!, FLOAT_TYPE) ? result : typeMismatch('T0008', diagnostics, span, FLOAT_TYPE, args[0]!),
});

// min/max: both arguments must be orderable (Comparable — Int/Float/String) and
// share a common type — their join, which is also the result, so 'min(2, 3.5)'
// is the Float 2.0. Two failure modes (no common type, or a common type that
// isn't orderable, e.g. two Bools) collapse into the one T0062.
const minMaxSig: ModuleFnSig = {
  arity: 2,
  resolve: (args, diagnostics, span) => {
    const join = leastCommonType(args[0]!, args[1]!);
    if (join === null || !satisfies('Comparable', join)) {
      diagnostics.error({ code: 'T0062', span, data: { left: typeToString(args[0]!), right: typeToString(args[1]!) } });
      return INVALID_TYPE;
    }
    return join;
  },
};

export const MODULE_SIGS: Record<string, Record<string, ModuleFnSig>> = {
  math: {
    min: minMaxSig,
    max: minMaxSig,
    sqrt: numeric1(FLOAT_TYPE),
    floor: numeric1(INT_TYPE),
    ceil: numeric1(INT_TYPE),
    round: numeric1(INT_TYPE),
  },
  assert: {
    assert: {
      arity: 1,
      resolve: (args, diagnostics, span) =>
        isAssignableTo(args[0]!, BOOL_TYPE) ? DONE_TYPE : typeMismatch('T0008', diagnostics, span, BOOL_TYPE, args[0]!),
    },
    // assertEqual compares with '==', which needs only a common type (records
    // compare structurally too, not just scalars) — so it asks for a join, not
    // Comparable. Mismatched, un-joinable types can never be equal (T0063).
    assertEqual: {
      arity: 2,
      resolve: (args, diagnostics, span) => {
        if (leastCommonType(args[0]!, args[1]!) === null) {
          diagnostics.error({ code: 'T0063', span, data: { left: typeToString(args[0]!), right: typeToString(args[1]!) } });
          return INVALID_TYPE;
        }
        return DONE_TYPE;
      },
    },
  },
};

// The one rule that checks a module call: arity first (T0007), then the export's
// own resolver. Both lookups are guaranteed present — the checker's import
// resolution already reported an unknown module (N0014) or export (N0015) — so a
// miss here is an internal invariant violation, not a user error.
export const moduleCallType = (
  module: string, name: string, args: AscentType[], diagnostics: Diagnostics, span: Span,
): AscentType => {
  const sig = MODULE_SIGS[module]?.[name];
  if (sig === undefined) throw new Error(`internal: no stdlib signature for '${module}.${name}'`);
  if (!requireArity(sig.arity, args.length, diagnostics, span)) return INVALID_TYPE;
  return sig.resolve(args, diagnostics, span);
};
