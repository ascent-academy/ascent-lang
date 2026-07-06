import type { Span } from '../lexer/token.js';
import {
  AscentType, TypeKind, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE,
  listOfType, optionalOf, leastCommonType, typesEqual, typeToString, INVALID_TYPE,
} from '../types/types.js';
import { Diagnostics, requireArity, typeMismatch } from './diagnostics.js';

// ---- Built-in signatures: data, not control flow ----------------------
//
// "What methods/functions exist" is data that grows whenever a builtin is
// added; "how a call is checked against that data" is the one rule below
// (methodCallType). Most signatures are monomorphic — fixed arity, fixed
// result; the List methods whose result depends on the receiver's element
// type keep a small resolver instead.
//
// None of this table or its dispatch needs to know about Invalid: synth's
// 'call'/'methodCall' cases (in ./synth.ts) bail out to Invalid *before*
// ever reaching this code whenever a receiver or argument already failed,
// so nothing here ever actually sees one.

export interface MonoSig {
  params: readonly AscentType[];
  result: AscentType;
}

export interface ResolvedSig {
  arity: number;
  resolve: (recv: AscentType, args: AscentType[], diagnostics: Diagnostics, span: Span) => AscentType;
}

export type MethodSig = MonoSig | ResolvedSig;

// Arity, then each param checked against its argument in order — pushes
// T0007 / T0008 and stops at the first mismatch, same as the old
// hand-rolled dispatchers.
const checkParams = (
  params: readonly AscentType[], args: AscentType[], diagnostics: Diagnostics, span: Span,
): boolean => {
  if (!requireArity(params.length, args.length, diagnostics, span)) return false;
  for (let i = 0; i < params.length; i++) {
    if (!typesEqual(args[i]!, params[i]!)) {
      typeMismatch('T0008', diagnostics, span, params[i]!, args[i]!);
      return false;
    }
  }
  return true;
};

const applySig = (
  sig: MethodSig, recv: AscentType, args: AscentType[], diagnostics: Diagnostics, span: Span,
): AscentType => {
  if ('result' in sig) return checkParams(sig.params, args, diagnostics, span) ? sig.result : INVALID_TYPE;
  if (!requireArity(sig.arity, args.length, diagnostics, span)) return INVALID_TYPE;
  return sig.resolve(recv, args, diagnostics, span);
};

// append and prepend put the value on different ends at runtime, but share
// one type rule: widen to the join of the element and argument types (e.g.
// appending a Float to a List<Int> gives List<Float>).
const appendLike = (recv: AscentType, args: AscentType[], diagnostics: Diagnostics, span: Span): AscentType => {
  if (recv.kind !== 'List') return INVALID_TYPE;
  const ct = leastCommonType(recv.elem, args[0]!);
  return ct === null ? typeMismatch('T0008', diagnostics, span, recv.elem, args[0]!) : listOfType(ct);
};

export const METHODS: Partial<Record<TypeKind, Record<string, MethodSig>>> = {
  Int: {
    toString: { params: [], result: STRING_TYPE },
    toFloat: { params: [], result: FLOAT_TYPE },
    abs: { params: [], result: INT_TYPE },
  },
  Float: {
    toString: { params: [], result: STRING_TYPE },
    toInt: { params: [], result: INT_TYPE },
    abs: { params: [], result: FLOAT_TYPE },
  },
  // design.md §4: no integer indexing on String — these named, grapheme-aware
  // methods replace it. length/first/last/chars/slice all count and cut on
  // characters (Unicode graphemes), never bytes or code units. first/last
  // return String? (None on an empty String) rather than crashing — the
  // "expected maybe-absent" tier, now that Optional exists.
  String: {
    length: { params: [], result: INT_TYPE },
    first: { params: [], result: optionalOf(STRING_TYPE) },
    last: { params: [], result: optionalOf(STRING_TYPE) },
    chars: { params: [], result: listOfType(STRING_TYPE) },
    slice: { params: [INT_TYPE, INT_TYPE], result: STRING_TYPE },
    repeat: { params: [INT_TYPE], result: STRING_TYPE },
    trim: { params: [], result: STRING_TYPE },
    padLeft: { params: [INT_TYPE], result: STRING_TYPE },
  },
  List: {
    length: { params: [], result: INT_TYPE },
    isEmpty: { params: [], result: BOOL_TYPE },
    reverse: { arity: 0, resolve: recv => recv.kind === 'List' ? listOfType(recv.elem) : INVALID_TYPE },
    append: { arity: 1, resolve: appendLike },
    prepend: { arity: 1, resolve: appendLike },
    concat: {
      arity: 1,
      resolve: (recv, args, diagnostics, span) => {
        if (recv.kind !== 'List') return INVALID_TYPE;
        const arg = args[0]!;
        if (arg.kind !== 'List') return typeMismatch('T0008', diagnostics, span, listOfType(recv.elem), arg);
        const ct = leastCommonType(recv.elem, arg.elem);
        return ct === null ? typeMismatch('T0008', diagnostics, span, listOfType(recv.elem), arg) : listOfType(ct);
      },
    },
  },
};

// Ascent's one built-in function, folded in as an ordinary signature
// instead of a special case in synth's 'call' branch.
export const FUNCTIONS: Record<string, MonoSig> = {
  floor: { params: [FLOAT_TYPE], result: FLOAT_TYPE },
};

// The one place a method call's result type is looked up: T0012 when the
// receiver's type has no methods at all, T0006 when it has methods but not
// this one, otherwise dispatch to the signature.
export const methodCallType = (
  recv: AscentType, method: string, args: AscentType[], diagnostics: Diagnostics, span: Span,
): AscentType => {
  const table = METHODS[recv.kind];
  if (table === undefined) {
    diagnostics.error({ code: 'T0012', span, data: { type: typeToString(recv) } });
    return INVALID_TYPE;
  }
  const sig = table[method];
  if (sig === undefined) {
    diagnostics.error({ code: 'T0006', span, data: { method, type: typeToString(recv) } });
    return INVALID_TYPE;
  }
  return applySig(sig, recv, args, diagnostics, span);
};
