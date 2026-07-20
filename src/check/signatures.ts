import type { Span } from '../lexer/token.js';
import {
  AscentType, TypeKind, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, DONE_TYPE,
  listOfType, optionalOf, leastCommonType, typesEqual, typeToString, INVALID_TYPE,
} from '../types/types.js';
import { Diagnostics, requireArity, typeMismatch } from './diagnostics.js';
import { Trait, satisfies } from './traits.js';

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
// T0014 / T0015 and stops at the first mismatch, same as the old
// hand-rolled dispatchers.
const checkParams = (
  params: readonly AscentType[], args: AscentType[], diagnostics: Diagnostics, span: Span,
): boolean => {
  if (!requireArity(params.length, args.length, diagnostics, span)) return false;
  for (let i = 0; i < params.length; i++) {
    if (!typesEqual(args[i]!, params[i]!)) {
      typeMismatch('T0015', diagnostics, span, params[i]!, args[i]!);
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
  return ct === null ? typeMismatch('T0015', diagnostics, span, recv.elem, args[0]!) : listOfType(ct);
};

export const METHODS: Partial<Record<TypeKind, Record<string, MethodSig>>> = {
  Int: {
    toString: { params: [], result: STRING_TYPE },
    toFloat: { params: [], result: FLOAT_TYPE },
    abs: { params: [], result: INT_TYPE },
  },
  // stdlib/scalars.md: a Float has no bare '.toInt()' — converting drops the
  // fractional part, and *how* is the caller's call, so the four named
  // roundings replace it (never a T0012-worthy bare toInt).
  Float: {
    toString: { params: [], result: STRING_TYPE },
    trunc: { params: [], result: INT_TYPE },
    round: { params: [], result: INT_TYPE },
    floor: { params: [], result: INT_TYPE },
    ceil: { params: [], result: INT_TYPE },
    abs: { params: [], result: FLOAT_TYPE },
  },
  Bool: {
    toString: { params: [], result: STRING_TYPE },
  },
  // stdlib/string.md: no integer indexing on String — these named,
  // grapheme-aware methods replace it. length/first/last/chars/slice/drop/take
  // all count and cut on characters (Unicode graphemes), never bytes or code
  // units. first/last return String? (None on an empty String) rather than
  // crashing — the "expected maybe-absent" tier, now that Optional exists.
  String: {
    length: { params: [], result: INT_TYPE },
    isEmpty: { params: [], result: BOOL_TYPE },
    first: { params: [], result: optionalOf(STRING_TYPE) },
    last: { params: [], result: optionalOf(STRING_TYPE) },
    chars: { params: [], result: listOfType(STRING_TYPE) },
    // stdlib/string.md: slice takes two grapheme indices, 'from' and 'to'
    // (half-open) — not a Range, which is reserved for iteration (§5) and
    // would teach a concept for this one use.
    slice: { params: [INT_TYPE, INT_TYPE], result: STRING_TYPE },
    drop: { params: [INT_TYPE], result: STRING_TYPE },
    take: { params: [INT_TYPE], result: STRING_TYPE },
    contains: { params: [STRING_TYPE], result: BOOL_TYPE },
    startsWith: { params: [STRING_TYPE], result: BOOL_TYPE },
    endsWith: { params: [STRING_TYPE], result: BOOL_TYPE },
    toUpper: { params: [], result: STRING_TYPE },
    toLower: { params: [], result: STRING_TYPE },
    toTitle: { params: [], result: STRING_TYPE },
    trim: { params: [], result: STRING_TYPE },
    trimStart: { params: [], result: STRING_TYPE },
    trimEnd: { params: [], result: STRING_TYPE },
    repeat: { params: [INT_TYPE], result: STRING_TYPE },
    padLeft: { params: [INT_TYPE], result: STRING_TYPE },
    padRight: { params: [INT_TYPE], result: STRING_TYPE },
    split: { params: [STRING_TYPE], result: listOfType(STRING_TYPE) },
    lines: { params: [], result: listOfType(STRING_TYPE) },
    codePoints: { params: [], result: listOfType(INT_TYPE) },
    bytes: { params: [], result: listOfType(INT_TYPE) },
    // stdlib/scalars.md: parsing can fail — a String might not name a
    // number/Bool — so each returns T?, never a bare T, forcing the miss to
    // be handled (?? / match / try) instead of hidden.
    toInt: { params: [], result: optionalOf(INT_TYPE) },
    toFloat: { params: [], result: optionalOf(FLOAT_TYPE) },
    toBool: { params: [], result: optionalOf(BOOL_TYPE) },
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
        if (arg.kind !== 'List') return typeMismatch('T0015', diagnostics, span, listOfType(recv.elem), arg);
        const ct = leastCommonType(recv.elem, arg.elem);
        return ct === null ? typeMismatch('T0015', diagnostics, span, listOfType(recv.elem), arg) : listOfType(ct);
      },
    },
  },
  // design.md §4: a Range is Int-only, so its methods are all monomorphic —
  // length is how many items it yields, toList materializes them, contains
  // tests membership. It "pairs cleanly with lengths" (the whitepaper), so
  // length reads exactly like a List's.
  Range: {
    length: { params: [], result: INT_TYPE },
    toList: { params: [], result: listOfType(INT_TYPE) },
    contains: { params: [INT_TYPE], result: BOOL_TYPE },
  },
};

// A builtin parameter's declared type: either a concrete type, or a
// trait-bounded type variable — the `T: Display` in `print<T: Display>(value:
// T)`. A bound accepts any argument type satisfying the trait; the variable
// never escapes into the result (print returns Done), so this needs no
// generics, only the predicate in traits.ts.
export type TraitBound = { readonly bound: Trait };
export type ParamType = AscentType | TraitBound;
export const isTraitBound = (p: ParamType): p is TraitBound => 'bound' in p;

// Whether an argument of `argType` is accepted by a parameter: a concrete
// parameter must match exactly, a bounded one must satisfy its trait.
export const paramAccepts = (param: ParamType, argType: AscentType): boolean =>
  isTraitBound(param) ? satisfies(param.bound, argType) : typesEqual(argType, param);

export interface FunctionSig {
  params: readonly ParamType[];
  result: AscentType;
}

// Ascent's built-in free functions, folded in as ordinary signatures instead
// of special cases in synth's 'call' branch. `print<T: Display>(value: T)`
// takes anything with a canonical text form — the same Display bound an
// interpolation hole carries — and yields Done, the unit value of a
// side-effecting call (whitepaper §7). So a scalar prints directly; a value
// with no text form is shown by interpolating a scalar field (`print("${x.n}")`)
// or converting it (`print(x.toString())`). `printInline` is print's no-newline
// twin (docs/version-0.1/stdlib/prelude.md) — same bound, same result.
export const FUNCTIONS: Record<string, FunctionSig> = {
  print: { params: [{ bound: 'Display' }], result: DONE_TYPE },
  printInline: { params: [{ bound: 'Display' }], result: DONE_TYPE },
};

// The prelude's ambient async input functions (docs/version-0.1/stdlib/
// prelude.md) — each shows its message and blocks for a line, so all four are
// async by nature and must be prepared with '!' and run through 'await', just
// like a user-defined 'async fn'; only the checker signature and the runtime
// behaviour behind it are built in rather than written in Ascent. Kept as its
// own table (not folded into FUNCTIONS) since synth's 'call' judgment must
// reject a *bare* call of one (T0053, the same mistake as calling a
// user-defined async fn without '!'), while 'asyncCall' is the only judgment
// that may actually resolve one.
export const ASYNC_FUNCTIONS: Record<string, MonoSig> = {
  prompt: { params: [STRING_TYPE], result: STRING_TYPE },
  promptInt: { params: [STRING_TYPE], result: INT_TYPE },
  promptFloat: { params: [STRING_TYPE], result: FLOAT_TYPE },
  promptBool: { params: [STRING_TYPE], result: BOOL_TYPE },
};

// '.orAbort(msg?)' unwraps a Result/Optional's good case or diverges through the
// bug-tier crash on its bad one (whitepaper §9). Its result is the unwrapped good
// type — a Result's ok side, an Optional's element. Unlike the table methods it is
// polymorphic over the two fallible boxes and dispatched on their *static* type
// (their runtime value carries no distinguishing type), so it lives here, not in
// METHODS. The optional message augments the crash, never replaces it, so it must
// be a String when present; a bad message poisons only itself, not the unwrapped
// result (which is known regardless), so it's still returned.
const orAbortType = (
  recv: Extract<AscentType, { kind: 'Result' | 'Optional' }>,
  args: AscentType[], diagnostics: Diagnostics, span: Span,
): AscentType => {
  if (args.length > 1) {
    diagnostics.error({ code: 'T0014', span, data: { expected: 'no input, or one String message', got: String(args.length) } });
  } else if (args.length === 1 && !typesEqual(args[0]!, STRING_TYPE)) {
    typeMismatch('T0015', diagnostics, span, STRING_TYPE, args[0]!);
  }
  return recv.kind === 'Result' ? recv.ok : recv.elem;
};

// The one place a method call's result type is looked up: T0011 when the
// receiver's type has no methods at all, T0012 when it has methods but not
// this one, otherwise dispatch to the signature.
export const methodCallType = (
  recv: AscentType, method: string, args: AscentType[], diagnostics: Diagnostics, span: Span,
): AscentType => {
  // Result/Optional aren't in METHODS (their sole method, orAbort, is polymorphic
  // over both and dispatched on the static box type — see orAbortType). Intercept
  // before the table lookup so 'r.orAbort()' resolves and 'r.foo()' is T0012 (a
  // real method exists, just not that one) rather than T0011 ("no methods").
  if (recv.kind === 'Result' || recv.kind === 'Optional') {
    if (method === 'orAbort') return orAbortType(recv, args, diagnostics, span);
    diagnostics.error({ code: 'T0012', span, data: { method, type: typeToString(recv) } });
    return INVALID_TYPE;
  }

  const table = METHODS[recv.kind];
  if (table === undefined) {
    diagnostics.error({ code: 'T0011', span, data: { type: typeToString(recv) } });
    return INVALID_TYPE;
  }
  const sig = table[method];
  if (sig === undefined) {
    diagnostics.error({ code: 'T0012', span, data: { method, type: typeToString(recv) } });
    return INVALID_TYPE;
  }
  return applySig(sig, recv, args, diagnostics, span);
};
