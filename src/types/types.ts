export type AscentType =
  | { kind: 'Int' }
  | { kind: 'Float' }
  | { kind: 'Bool' }
  | { kind: 'String' }
  | { kind: 'None' }
  | { kind: 'Done' }
  | { kind: 'Never' }
  | { kind: 'Invalid' }
  | { kind: 'List'; elem: AscentType }
  | { kind: 'Optional'; elem: AscentType }
  // whitepaper §9: a fallible value — `Success{ value: T } | Failure{ error: E }`,
  // written `T orfail E` in source. Like Optional it is its own kind rather than
  // a registered union (generics aren't user-definable, §7), carrying the two
  // component types: `ok` (the Success payload) and `err` (the Failure reason).
  // A `Success{ … }` value's type is `Result<T, Never>` and a `Failure{ … }`'s is
  // `Result<Never, E>` — the unknown side is Never, which widens into whatever the
  // expected `T orfail E` supplies (subtype() below), the same trick `[]`'s
  // `List<Never>` and a bare `None` use. Covariant in both components (sound only
  // because values are immutable, like List).
  | { kind: 'Result'; ok: AscentType; err: AscentType }
  // design.md §4: a half-open Int range 'a..b'. Monomorphic — the bounds
  // and the values it yields are always Int — so, unlike List/Optional, it
  // carries no element parameter. Iterating one (a 'for' loop) gives Int.
  | { kind: 'Range' }
  // whitepaper §8: the inert result of an async call — 'fetchUser!(id)' has
  // type 'Task<User>'. It is a *description* of work with its arguments already
  // bound, not running work; the only way to run it is 'await', which yields the
  // `result` T. Like List/Optional/Result it carries one component type but,
  // unlike them, it is invariant (a Task<Int> is not a Task<Float>) — awaiting
  // it would need to coerce the eventual value, so v1 keeps it equal-or-nothing,
  // exactly as Function is. There are no free-floating tasks: nurseries and
  // concurrency are deferred (§8's structured-concurrency half), so 'await' is
  // the sole consumer.
  | { kind: 'Task'; result: AscentType }
  // design.md §6/§7: a nominal reference to a user-declared type (a record —
  // and, later, a tagged union). Identity is the `name` alone — the type is a
  // lightweight handle; its structure (variants → fields) lives in the
  // checker's type registry (src/check/env.ts's TypeEnv), looked up by name.
  // Nominal typing means two Named types relate only when their names match.
  | { kind: 'Named'; name: string }
  // whitepaper §5/§7: a first-class function value's type — `Fn(Int, String) ->
  // Bool`. Both the parameter types and the result are always known from the
  // function's (fully explicit) signature, never inferred from its body. Unlike
  // List/Optional this is structural in the shallow sense that two arrow types
  // relate only when their arities and every part match exactly — arrow types
  // are *invariant* (subtype() below), keeping §7's "no variance" intact.
  // `async` is the function's *color* (whitepaper §8): an async function is a
  // distinct type from a plain one with the same signature — it is called with
  // '!' to prepare a 'Task<result>', never called directly — so the flag is part
  // of type identity (typesEqual below compares it).
  | { kind: 'Function'; params: AscentType[]; result: AscentType; async: boolean };

export type TypeKind = AscentType['kind'];

export const INT_TYPE: AscentType = { kind: 'Int' };
export const FLOAT_TYPE: AscentType = { kind: 'Float' };
export const BOOL_TYPE: AscentType = { kind: 'Bool' };
export const STRING_TYPE: AscentType = { kind: 'String' };
export const NONE_TYPE: AscentType = { kind: 'None' };
export const DONE_TYPE: AscentType = { kind: 'Done' };
// design.md §7: the bottom type — uninhabited, assignable to every type. Not
// (yet) a type anyone writes; it only ever shows up as the checker's own
// inference for a diverging expression, or (below) an empty list literal.
export const NEVER_TYPE: AscentType = { kind: 'Never' };
// agenda/typechecker-refactor.md Phase 5: a checker-internal tombstone for a sub-expression whose
// own type-checking already failed (a diagnostic was reported at that node) —
// never written in source, never shown in a message. It is Never's dual:
// Never is the honest bottom of a *valid* program, Invalid marks a *broken*
// one. See subtype()/leastCommonType() below for the "absorbs both
// directions" rule that lets a failure stop at the point it's reported
// instead of cascading into new, misleading diagnostics further up the tree.
export const INVALID_TYPE: AscentType = { kind: 'Invalid' };
export const RANGE_TYPE: AscentType = { kind: 'Range' };
export const listOfType = (elem: AscentType): AscentType => ({ kind: 'List', elem });
export const optionalOf = (elem: AscentType): AscentType => ({ kind: 'Optional', elem });
export const resultOf = (ok: AscentType, err: AscentType): AscentType => ({ kind: 'Result', ok, err });
export const namedType = (name: string): AscentType => ({ kind: 'Named', name });
export const functionType = (params: AscentType[], result: AscentType, async = false): AscentType => ({ kind: 'Function', params, result, async });
export const taskOf = (result: AscentType): AscentType => ({ kind: 'Task', result });

// design.md §4: 'T?' is surface sugar for 'Optional<T>' — render it that way
// everywhere a type shows up (diagnostics, the REPL, the AST printers)
// rather than as 'Optional<T>', since that sugar is what a learner wrote.
export const typeToString = (t: AscentType): string => {
  if (t.kind === 'List') {
    return `List<${typeToString(t.elem)}>`;
  }
  if (t.kind === 'Optional') {
    return `${typeToString(t.elem)}?`;
  }
  // 'T orfail E' — the surface spelling of Result, what a learner wrote
  // (whitepaper §9), never 'Result<T, E>'.
  if (t.kind === 'Result') {
    return `${typeToString(t.ok)} orfail ${typeToString(t.err)}`;
  }
  // A Task shows as 'Task<T>' — the inferred type of an async call 'f!(x)'
  // (whitepaper §8), the same angle-bracket form as List<T>.
  if (t.kind === 'Task') {
    return `Task<${typeToString(t.result)}>`;
  }
  // A Named type shows as the name the learner declared ('Person'), never
  // 'Named' — the 'kind' is an implementation label, not user vocabulary.
  if (t.kind === 'Named') {
    return t.name;
  }
  // A function type shows in its source spelling: 'Fn(Int, String) -> Bool',
  // capitalized (it is a type) with the arrow, no space before the '(' — as
  // written in an annotation, distinct from the lowercase 'fn(...)' value. An
  // async function has no writable type in v1, so it is shown with an 'async'
  // prefix (surfacing only in a dump / an error) to keep its color visible.
  if (t.kind === 'Function') {
    const fn = `Fn(${t.params.map(typeToString).join(', ')}) -> ${typeToString(t.result)}`;
    return t.async ? `async ${fn}` : fn;
  }
  return t.kind;
};

// design.md §4's "Scalars" heading: Int, Float, Bool, String — every type
// with one obvious, total way to show as text. Used to let a '${ }'
// interpolation hole (§4/§6) accept these without an explicit '.toString()'
// call; a hardcoded rule until a Show-style trait (§7) can express it as
// ordinary dispatch instead.
export const isScalarType = (t: AscentType): boolean =>
  t.kind === 'Int' || t.kind === 'Float' || t.kind === 'Bool' || t.kind === 'String';

// agenda/typechecker-refactor.md Phase 5: true for the checker-internal
// Invalid tombstone — a sub-expression whose own type-checking already
// failed and reported its diagnostic there. Never written in source, never
// shown in a message; callers use this to skip checks that Invalid itself
// would poison, without a second, cascaded diagnostic.
export const isInvalidType = (t: AscentType): boolean => t.kind === 'Invalid';

// True when 'Never' appears anywhere in t's structure — catches not just a
// bare '[]' but anything built from one with no widening context
// ('[].reverse()', '[[]]', …), since all of those freeze the same way once a
// slot's type is fixed (design.md §7).
export const containsNever = (t: AscentType): boolean => {
  if (t.kind === 'Never') return true;
  if (t.kind === 'List' || t.kind === 'Optional') return containsNever(t.elem);
  // A Result carries an unresolved Never whenever either component does — a
  // 'Success{ … }' freezes err at Never, a 'Failure{ … }' freezes ok at Never,
  // so a bare one in a slot needs an annotation just like '[]'/'None'.
  if (t.kind === 'Result') return containsNever(t.ok) || containsNever(t.err);
  // A Task carries an unresolved Never whenever its result does — though in
  // practice an async function's result type is always written explicitly, so
  // this is for completeness (a slot 'fix t = ...' holding a Task<Never>).
  if (t.kind === 'Task') return containsNever(t.result);
  return false;
};

export const typesEqual = (a: AscentType, b: AscentType): boolean => {
  if (a.kind !== b.kind) {
    return false;
  }

  if (a.kind === 'List' && b.kind === 'List') {
    return typesEqual(a.elem, b.elem);
  }

  if (a.kind === 'Optional' && b.kind === 'Optional') {
    return typesEqual(a.elem, b.elem);
  }

  if (a.kind === 'Result' && b.kind === 'Result') {
    return typesEqual(a.ok, b.ok) && typesEqual(a.err, b.err);
  }

  // Two Tasks are equal exactly when their result types are — Task is invariant,
  // so this equality is the whole subtyping story for it (whitepaper §8).
  if (a.kind === 'Task' && b.kind === 'Task') {
    return typesEqual(a.result, b.result);
  }

  // Nominal: two Named types are the same type exactly when they carry the
  // same declared name (design.md §7 — "a User is a User because it was
  // declared one"). The fields don't enter into it — that's what makes this
  // nominal, not structural.
  if (a.kind === 'Named' && b.kind === 'Named') {
    return a.name === b.name;
  }

  // Two function types are equal when their arities match and every parameter
  // and the result are pairwise equal — arrow types have no widening of their
  // own (they're invariant, see subtype() below), so equality is the whole story.
  if (a.kind === 'Function' && b.kind === 'Function') {
    return a.async === b.async
      && a.params.length === b.params.length
      && a.params.every((p, i) => typesEqual(p, b.params[i]!))
      && typesEqual(a.result, b.result);
  }

  return true;
};

// A coercion is the runtime witness of a subtyping edge: how to turn a value
// of the sub-type into one of the super-type. `null` means the two types are
// equal — no runtime conversion needed.
export type Coercion = 'intToFloat' | { elem: Coercion } | { ok: Coercion; err: Coercion } | null;

// S <: T — the one place widening is defined. `Never` widens to *any* T
// (design.md §7 — it's uninhabited, so the edge is vacuously sound: there's
// never actually a Never value to convert, so `null` is a safe placeholder
// witness regardless of what T turns out to be). Int widens to Float, lists
// widen covariantly (sound only because Ascent lists are immutable: append /
// prepend / concat return new lists rather than mutating in place), and — the
// other hard-coded widening rule design.md §7 calls out — a non-null T widens
// to T?: a bare value needs no runtime change to become "present" (there's no
// Some(...) wrapper, design.md §4), and None widens to T? for any T since it's
// already the Optional's absent case. Both reuse whatever coercion the inner
// types need (e.g. Int widening into Float? still yields 'intToFloat'), never
// a nested { elem: … } witness — unlike List, an Optional value is never
// wrapped, so the coercion applies straight to the raw value at runtime.
// Returns the coercion that witnesses the edge, or `false` when S is not a
// subtype of T.
export const subtype = (sub: AscentType, sup: AscentType): Coercion | false => {
  // Invalid absorbs both directions (agenda/typechecker-refactor.md Phase 5): it's
  // assignable to every type and every type is assignable to it, so a value
  // that already failed to check satisfies whatever expectation meets it
  // next without a second diagnostic. `null` is a safe placeholder witness
  // here — this coercion must never actually run (Rule 4: a tree containing
  // Invalid never reaches execution).
  if (sub.kind === 'Invalid' || sup.kind === 'Invalid') {
    return null;
  }

  if (typesEqual(sub, sup)) {
    return null;
  }

  if (sub.kind === 'Never') {
    return null;
  }

  if (sub.kind === 'Int' && sup.kind === 'Float') {
    return 'intToFloat';
  }

  if (sub.kind === 'List' && sup.kind === 'List') {
    const c = subtype(sub.elem, sup.elem);
    return c === false ? false : { elem: c };
  }

  if (sup.kind === 'Optional') {
    if (sub.kind === 'None') return null;
    const subElem = sub.kind === 'Optional' ? sub.elem : sub;
    return subtype(subElem, sup.elem);
  }

  // Result is covariant in both components (immutable, so covariance is sound,
  // like List). This is what lets a 'Success{ … }' (Result<T, Never>) or a
  // 'Failure{ … }' (Result<Never, E>) flow into the declared 'T orfail E' — the
  // Never side widens away. The witness carries the per-branch coercion so
  // applyCoercion can descend into whichever branch the runtime value is
  // (Success → coerce its 'value' by `ok`, Failure → its 'error' by `err`);
  // `null` when neither branch actually needs converting, keeping it a no-op.
  if (sub.kind === 'Result' && sup.kind === 'Result') {
    const okC = subtype(sub.ok, sup.ok);
    const errC = subtype(sub.err, sup.err);
    if (okC === false || errC === false) return false;
    if (okC === null && errC === null) return null;
    return { ok: okC, err: errC };
  }

  return false;
};

// The least common supertype — derived from subtyping. When one side
// subtypes the other, that supertype is the join. Otherwise, for two lists
// whose elements aren't directly related by subtyping, recurse on the
// elements (structural join; doesn't add any widening knowledge of its own).
// Returns null when the two types have no common supertype.
export const leastCommonType = (a: AscentType, b: AscentType): AscentType | null => {
  // Checked explicitly (rather than left to fall out of subtype() below) so
  // the join is Invalid regardless of which side it's on — subtype()'s
  // absorption alone would make the *first* subtype(a, b) check succeed and
  // return `b` even when only `a` is Invalid, silently discarding the
  // failure instead of propagating it (agenda/typechecker-refactor.md Phase 5).
  if (a.kind === 'Invalid' || b.kind === 'Invalid') {
    return INVALID_TYPE;
  }

  if (subtype(a, b) !== false) {
    return b;
  }

  if (subtype(b, a) !== false) {
    return a;
  }

  if (a.kind === 'List' && b.kind === 'List') {
    const elem = leastCommonType(a.elem, b.elem);
    return elem !== null ? listOfType(elem) : null;
  }
  // Join two Results component-wise — the case that matters is a 'Success'
  // (Result<T, Never>) and a 'Failure' (Result<Never, E>) arm joining to the
  // whole Result<T, E>, e.g. an 'if' or a function body producing one or the
  // other. Neither subtypes the other, so the join has to build both sides.
  if (a.kind === 'Result' && b.kind === 'Result') {
    const ok = leastCommonType(a.ok, b.ok);
    const err = leastCommonType(a.err, b.err);
    return ok !== null && err !== null ? resultOf(ok, err) : null;
  }
  return null;
};

// `from` is assignable to `to` exactly when it's a subtype of `to`.
export const isAssignableTo = (from: AscentType, to: AscentType): boolean => subtype(from, to) !== false;
