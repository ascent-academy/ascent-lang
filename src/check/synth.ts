import type { Expr, FieldInit, PathStep } from '../parser/ast.js';
import type { Span } from '../lexer/token.js';
import type { TypedExpr, TypedTemplatePart, TypedFieldInit, TypedWithUpdate, TypedPathStep, TypedTryElse } from '../parser/typed-ast.js';
import {
  AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, NONE_TYPE, DONE_TYPE, NEVER_TYPE, INVALID_TYPE, RANGE_TYPE,
  listOfType, leastCommonType, joinTypes, typeToString, isInvalidType, namedType, functionType, isAssignableTo, resultOf, taskOf,
  typesEqual,
} from '../types/types.js';
import type { TypeEnv } from './env.js';
import { Diagnostics, requireArity, typeMismatch, operandError } from './diagnostics.js';
import { methodCallType, FUNCTIONS, ASYNC_FUNCTIONS, paramAccepts, isTraitBound } from './signatures.js';
import { MODULE_SIGS, moduleCallType } from './stdlib.js';
import { BUILTIN_TYPE_NAMES, typeFromExpr } from './formation.js';
import { freeVariables } from './captures.js';
import { satisfies } from './traits.js';
import { inferBlock, inferIf, inferMatch } from './stmt.js';
import { check } from './check.js';

// ---- Expression synthesis:  Γ ⊢ e ⇒ T --------------------------------
//
// No expectation flows in; produce a type from the expression alone.
// Always returns a TypedExpr with a type embedded — a sub-expression that
// fails to check gets Invalid (agenda/typechecker-refactor.md Phase 5)
// instead of null, so a caller never needs to abort just to keep checking
// the rest of the tree; it only needs to skip the checks that Invalid
// itself would poison (see each case's own "already Invalid" guard below).

// The join of a non-empty list literal's typed elements, pairwise against
// the first — T0005 when two elements share no common supertype. Shared by
// synth (the result is the list's type, as-is) and check (which may still
// widen the result further toward an expected element type). Uses joinTypes,
// so a mix of a value and an optional folds into an optional element — '[None,
// 1]' is 'List<Int?>', '[x, None]' (x: Int) likewise. joinTypes is Invalid-aware
// (via leastCommonType), so an element that failed on its own quietly carries
// Invalid through the join without a second diagnostic here.
export const joinElementTypes = (typedElements: TypedExpr[], span: Span, diagnostics: Diagnostics): AscentType => {
  let elemType: AscentType = typedElements[0]!.type;
  for (const te of typedElements.slice(1)) {
    const ct = joinTypes(elemType, te.type);
    if (ct === null) {
      diagnostics.error({
        code: 'T0005', span,
        data: { first: typeToString(elemType), other: typeToString(te.type) },
        related: [{ key: 'element', span: te.span }],
      });
      return INVALID_TYPE;
    }
    elemType = ct;
  }
  return elemType;
};

// A canonical string key for a 'with' update path, but only when every step is
// statically comparable — a field name, or an integer-literal index. Any
// computed index (e.g. '[i]') makes the path 'dynamic' → null, so it's never
// treated as a duplicate (we can't decide whether '[i]' and '[j]' collide).
export const pathKey = (path: PathStep[]): string | null => {
  const parts: string[] = [];
  for (const step of path) {
    if (step.kind === 'field') parts.push(`.${step.field}`);
    else if (step.index.kind === 'literal' && step.index.valueType === 'Int') parts.push(`[${step.index.value}]`);
    else return null;
  }
  return parts.join('');
};

// The same path rendered for a human (a duplicate-path message) — a leading
// field bare ('users'), later steps dotted ('.address'), indices bracketed.
export const pathDisplay = (path: PathStep[]): string => {
  let out = '';
  path.forEach((step, i) => {
    if (step.kind === 'field') out += i === 0 ? step.field : `.${step.field}`;
    else out += step.index.kind === 'literal' && step.index.valueType === 'Int' ? `[${step.index.value}]` : '[…]';
  });
  return out;
};

// Check a call's arguments against a function type: arity (T0014), then each
// argument assignable to its parameter (T0015 — assignable, not exact, so an Int
// widens into a Float parameter, the one-way rule of §5). Returns the function's
// result type, or Invalid on the first failure. Shared by a by-name call
// ('call') and a computed call ('apply').
export const checkApplication = (
  fn: Extract<AscentType, { kind: 'Function' }>,
  argTypes: AscentType[],
  diagnostics: Diagnostics,
  span: Span,
): AscentType => {
  if (!requireArity(fn.params.length, argTypes.length, diagnostics, span)) return INVALID_TYPE;
  for (let i = 0; i < fn.params.length; i++) {
    if (!isAssignableTo(argTypes[i]!, fn.params[i]!)) {
      return typeMismatch('T0015', diagnostics, span, fn.params[i]!, argTypes[i]!);
    }
  }
  return fn.result;
};

// whitepaper §9: the two built-in Result constructors, 'Success{ value: T }' and
// 'Failure{ error: E }'. They aren't user-declared types, so construction is
// handled here rather than through env.getConstructor. A 'Success' synthesizes
// to Result<T, Never> and a 'Failure' to Result<Never, E> — the *unknown* side is
// Never, which widens into whatever 'T orfail E' the value flows into (an
// annotation, a return type), exactly as a bare 'None' widens into 'T?'. The one
// declared field ('value'/'error') is required, and the same missing / unknown /
// duplicate-field rules a record gets apply (T0022 / T0023 / T0024). At runtime
// the value is just a record named 'Success'/'Failure' carrying that field, so
// the interpreter builds and matches it with no Result-specific machinery.
const synthResultConstruct = (
  expr: Extract<Expr, { kind: 'construct' }>,
  tag: 'Success' | 'Failure',
  env: TypeEnv,
  diagnostics: Diagnostics,
): TypedExpr => {
  const fieldName = tag === 'Success' ? 'value' : 'error';
  let payload: TypedExpr | null = null;
  const seen = new Set<string>();
  for (const f of expr.fields) {
    const typedValue = synth(f.value, env, diagnostics);
    if (seen.has(f.name)) {
      diagnostics.error({ code: 'T0024', span: f.nameSpan, data: { field: f.name, type: tag } });
      continue;
    }
    seen.add(f.name);
    if (f.name !== fieldName) {
      diagnostics.error({ code: 'T0023', span: f.nameSpan, data: { field: f.name, type: tag } });
      continue;
    }
    payload = typedValue;
  }
  if (payload === null) {
    diagnostics.error({ code: 'T0022', span: expr.typeNameSpan, data: { type: tag, fields: fieldName } });
  }
  const payloadType = payload?.type ?? INVALID_TYPE;
  const type = tag === 'Success' ? resultOf(payloadType, NEVER_TYPE) : resultOf(NEVER_TYPE, payloadType);
  const fields: TypedFieldInit[] = payload !== null
    ? [{ name: fieldName, declaredType: payloadType, value: payload }]
    : [];
  return { kind: 'construct', typeName: tag, fields, type, span: expr.span };
};

// whitepaper §9: 'try expr' / 'try expr else [e] -> mapExpr'. `try` unwraps the
// good case of an Optional/Result and continues, or early-returns the bad case
// from the enclosing function — so it must sit inside a function (T0049) whose
// declared return type can carry that bad case (T0051). The plain form
// propagates the failure/None unchanged; the 'else' form maps the error to a new
// value and propagates it as a 'Failure'. The whole expression's type is the
// unwrapped good value's type T (the bad path diverges via return, so it doesn't
// contribute a type). Modeled on 'return': the propagated value is coerced into
// the return type at runtime, so the typed node carries both.
const synthTry = (
  expr: Extract<Expr, { kind: 'try' }>,
  env: TypeEnv,
  diagnostics: Diagnostics,
): TypedExpr => {
  const typedSubject = synth(expr.subject, env, diagnostics);
  const st = typedSubject.type;
  const returnType = env.enclosingReturn();

  // The subject must be an Optional or a Result — the two fallible boxes 'try'
  // opens. Its good (unwrapped) type is the whole expression's type; its err type
  // (for a Result) is what an 'else' binding names.
  let goodType: AscentType = INVALID_TYPE;
  let errType: AscentType | null = null;
  let subjectShape: 'optional' | 'result' | null = null;
  if (st.kind === 'Optional') {
    goodType = st.elem;
    subjectShape = 'optional';
  } else if (st.kind === 'Result') {
    goodType = st.ok;
    errType = st.err;
    subjectShape = 'result';
  } else if (!isInvalidType(st)) {
    diagnostics.error({ code: 'T0050', span: expr.subject.span, data: { actual: typeToString(st) } });
  }

  // 'try' hands the bad case to the enclosing function; outside one there is
  // nowhere for it to go (the same shape as a 'return' outside a function, T0043).
  if (returnType === null) {
    diagnostics.error({ code: 'T0049', span: expr.span });
  }

  // The value returned on the bad path, and a human phrase for the diagnostic.
  let propagateType: AscentType = INVALID_TYPE;
  let propagated = '';
  let typedElse: TypedTryElse | null = null;

  if (expr.elseClause === null) {
    // Plain 'try': propagate the failure / None exactly as it is.
    if (subjectShape === 'result') {
      propagateType = resultOf(NEVER_TYPE, errType!);
      propagated = `a failure (${typeToString(errType!)})`;
    } else if (subjectShape === 'optional') {
      propagateType = NONE_TYPE;
      propagated = 'None';
    }
  } else {
    // 'try … else': bind the error (Result only), map it, propagate as a Failure.
    const armEnv = env.child();
    if (expr.elseClause.binding !== null) {
      if (subjectShape === 'optional') {
        // An Optional's absent case is 'None' — it carries no error to bind.
        diagnostics.error({ code: 'T0052', span: expr.elseClause.binding.span });
      }
      armEnv.set(expr.elseClause.binding.name, errType ?? INVALID_TYPE, 'fix', expr.elseClause.binding.span);
    }
    const typedBody = synth(expr.elseClause.body, armEnv, diagnostics);
    typedElse = { binding: expr.elseClause.binding?.name ?? null, body: typedBody };
    propagateType = resultOf(NEVER_TYPE, typedBody.type);
    propagated = `a failure (${typeToString(typedBody.type)})`;
  }

  // The enclosing function's return type has to be able to hold the propagated
  // bad case (whitepaper §9: "a function that uses 'try' must itself return a
  // compatible Optional/Result"). Quiet when the subject was already invalid or
  // there is no function at all — those failures are reported above.
  if (returnType !== null && subjectShape !== null && !isInvalidType(propagateType)
    && !isAssignableTo(propagateType, returnType)) {
    diagnostics.error({
      code: 'T0051', span: expr.span,
      data: { propagated, ret: typeToString(returnType) },
    });
  }

  return {
    kind: 'try',
    subject: typedSubject,
    elseClause: typedElse,
    returnType: returnType ?? INVALID_TYPE,
    propagateType,
    type: goodType,
    span: expr.span,
  };
};

// 'math.min(…)' — a namespace import's qualified call (whitepaper §10). Resolves
// the export against the module `module` and produces a 'call' node carrying it,
// identical to what a named import's bare 'min(…)' yields, so both spellings walk
// the same interpreter path. An export the module doesn't have is N0015 (the
// method-call twin of a named import's unknown-export error).
const synthNamespaceCall = (
  module: string, expr: Extract<Expr, { kind: 'methodCall' }>, env: TypeEnv, diagnostics: Diagnostics,
): TypedExpr => {
  const typedArgs = expr.args.map(arg => synth(arg, env, diagnostics));
  const asCall = (type: AscentType): TypedExpr =>
    ({ kind: 'call', callee: expr.method, module, args: typedArgs, type, span: expr.span });

  if (typedArgs.some(a => isInvalidType(a.type))) return asCall(INVALID_TYPE);
  if (MODULE_SIGS[module]?.[expr.method] === undefined) {
    diagnostics.error({ code: 'N0015', span: expr.span, data: { module, name: expr.method } });
    return asCall(INVALID_TYPE);
  }
  return asCall(moduleCallType(module, expr.method, typedArgs.map(a => a.type), diagnostics, expr.span));
};

export const synth = (expr: Expr, env: TypeEnv, diagnostics: Diagnostics): TypedExpr => {
  switch (expr.kind) {
    case 'literal': {
      switch (expr.valueType) {
        case 'Int': return { ...expr, type: INT_TYPE };
        case 'Float': return { ...expr, type: FLOAT_TYPE };
        case 'Bool': return { ...expr, type: BOOL_TYPE };
        case 'String': return { ...expr, type: STRING_TYPE };
        case 'None': return { ...expr, type: NONE_TYPE };
        case 'Done': return { ...expr, type: DONE_TYPE };
      }
    }

    // A '${ }' hole splices its value straight into the surrounding text. Any
    // scalar (Int/Float/Bool/String, design.md §4) is accepted as-is — a
    // hardcoded rule standing in for a Show-style trait until traits exist
    // (§7); anything else (None, Done, List) has no obvious text form and
    // must be converted explicitly first. A String with no holes never
    // reaches here — it stays the plain 'literal' case above. The template's
    // own type is always String regardless of a hole's validity — unlike an
    // arithmetic operand, a hole's type never decides *what kind of value*
    // the template produces, so there's no reason to poison it with Invalid;
    // an already-Invalid hole just skips the redundant T0018 (its own
    // failure was reported where it was synthesized).
    case 'template': {
      const typedParts: TypedTemplatePart[] = [];
      for (const part of expr.parts) {
        if (part.kind === 'text') {
          typedParts.push(part);
          continue;
        }
        const typedHole = synth(part.expr, env, diagnostics);
        // A hole is a Display-bounded position (the same bound as print's
        // argument) — it must have a canonical text form to splice in.
        if (!isInvalidType(typedHole.type) && !satisfies('Display', typedHole.type)) {
          diagnostics.error({ code: 'T0018', span: part.expr.span, data: { actual: typeToString(typedHole.type) } });
        }
        typedParts.push({ kind: 'hole', expr: typedHole });
      }
      return { kind: 'template', parts: typedParts, type: STRING_TYPE, span: expr.span };
    }

    case 'slot': {
      const binding = env.get(expr.name);
      if (binding === null) {
        // A bare built-in / imported / namespace name in value position, not a
        // call. A namespace ('math') is reached qualified, so it's N0016; a
        // built-in async function (the 'prompt' family) can only be prepared
        // with '!' and awaited, so it gets its own message (N0017); an ambient
        // sync builtin (print) or imported stdlib function (min) has no
        // first-class type yet — it can only be called — so it's N0013,
        // clearer than "undefined name". A call 'print(x)' never reaches here
        // (it's a 'call' node). Otherwise the name simply isn't declared (N0001).
        let code = 'N0001';
        if (env.getNamespace(expr.name) !== null) code = 'N0016';
        else if (ASYNC_FUNCTIONS[expr.name] !== undefined) code = 'N0017';
        else if (FUNCTIONS[expr.name] !== undefined || env.getImportedFn(expr.name) !== null) code = 'N0013';
        diagnostics.error({ code, span: expr.span, data: { name: expr.name } });
        return { ...expr, type: INVALID_TYPE };
      }
      return { ...expr, type: binding.ty };
    }

    case 'call': {
      const typedArgs = expr.args.map(arg => synth(arg, env, diagnostics));
      const invalid = (): TypedExpr => ({ kind: 'call', callee: expr.callee, args: typedArgs, type: INVALID_TYPE, span: expr.span });

      // A built-in free function (print today) is checked against its own
      // signature, which may carry a trait bound the user-function path has no
      // notion of. Builtins take priority over a same-named slot.
      const builtin = FUNCTIONS[expr.callee];
      if (builtin !== undefined) {
        // Any argument that already failed poisons the whole call (Rule 2).
        if (typedArgs.some(a => isInvalidType(a.type))) return invalid();
        if (!requireArity(builtin.params.length, typedArgs.length, diagnostics, expr.span)) return invalid();
        for (let i = 0; i < builtin.params.length; i++) {
          const param = builtin.params[i]!;
          const argType = typedArgs[i]!.type;
          if (!paramAccepts(param, argType)) {
            // A concrete parameter that doesn't match is an ordinary type
            // mismatch (T0015); an unmet trait bound (only print's Display today)
            // has no single "expected type" to name, so it gets its own message.
            if (isTraitBound(param)) {
              diagnostics.error({ code: 'T0019', span: expr.span, data: { actual: typeToString(argType) } });
            } else {
              typeMismatch('T0015', diagnostics, expr.span, param, argType);
            }
            return invalid();
          }
        }
        return { kind: 'call', callee: expr.callee, args: typedArgs, type: builtin.result, span: expr.span };
      }

      // A bare call of a built-in async function (the 'prompt' family) is the
      // same mistake as calling a user-defined async fn without '!' (T0053):
      // it must be prepared into a Task and awaited, never called directly.
      if (ASYNC_FUNCTIONS[expr.callee] !== undefined) {
        diagnostics.error({ code: 'T0053', span: expr.span });
        return invalid();
      }

      // A stdlib function brought in bare by a named import ('import { min } from
      // "math"') — resolved against the module registry, like print but gated by
      // the import. Rewrites to a 'call' carrying its `module`, the one node the
      // interpreter dispatches every stdlib call through.
      const importedModule = env.getImportedFn(expr.callee);
      if (importedModule !== null) {
        if (typedArgs.some(a => isInvalidType(a.type))) return invalid();
        const result = moduleCallType(importedModule, expr.callee, typedArgs.map(a => a.type), diagnostics, expr.span);
        return { kind: 'call', callee: expr.callee, module: importedModule, args: typedArgs, type: result, span: expr.span };
      }

      // A namespace import ('import math') isn't callable on its own — you call
      // its exports ('math.min(…)'), not the module (N0016).
      if (env.getNamespace(expr.callee) !== null) {
        diagnostics.error({ code: 'N0016', span: expr.span, data: { name: expr.callee } });
        return invalid();
      }

      // Otherwise the callee must be a slot holding a function value
      // (whitepaper §5 — functions are ordinary values, called by name).
      const binding = env.get(expr.callee);
      if (binding === null) {
        diagnostics.error({ code: 'T0013', span: expr.span, data: { name: expr.callee } });
        return invalid();
      }
      if (isInvalidType(binding.ty)) return invalid();
      if (binding.ty.kind !== 'Function') {
        // The name exists but isn't a function, so it can't be called.
        diagnostics.error({ code: 'T0016', span: expr.span, data: { name: expr.callee, type: typeToString(binding.ty) } });
        return invalid();
      }
      // A bare call of an async function is a compile error (whitepaper §8):
      // calling-and-running is not something an async function can do — it must
      // be prepared into a Task with '!' and then awaited.
      if (binding.ty.async) {
        diagnostics.error({ code: 'T0053', span: expr.span });
        return invalid();
      }
      if (typedArgs.some(a => isInvalidType(a.type))) return invalid();

      const result = checkApplication(binding.ty, typedArgs.map(a => a.type), diagnostics, expr.span);
      return { kind: 'call', callee: expr.callee, args: typedArgs, type: result, span: expr.span };
    }

    case 'apply': {
      // Calling a *computed* function value (whitepaper §5 — functions are
      // ordinary values). Synthesize the callee, require it to be a function,
      // then check the arguments against it just like a by-name call.
      const typedCallee = synth(expr.callee, env, diagnostics);
      const typedArgs = expr.args.map(arg => synth(arg, env, diagnostics));
      const invalid = (): TypedExpr => ({ kind: 'apply', callee: typedCallee, args: typedArgs, type: INVALID_TYPE, span: expr.span });

      if (isInvalidType(typedCallee.type) || typedArgs.some(a => isInvalidType(a.type))) return invalid();
      if (typedCallee.type.kind !== 'Function') {
        // The callee is a value that isn't a function, so it can't be called
        // (T0017 — the nameless twin of T0016 for a by-name call).
        diagnostics.error({ code: 'T0017', span: expr.callee.span, data: { type: typeToString(typedCallee.type) } });
        return invalid();
      }
      // An async function reached in computed position can't be run directly
      // either — the '!' mark that prepares its Task attaches only to a bare
      // name in v1, so there is no way to call this. Report the same bare-async
      // error (whitepaper §8); {found} names the offending call in the message.
      if (typedCallee.type.async) {
        diagnostics.error({ code: 'T0053', span: expr.span });
        return invalid();
      }
      const result = checkApplication(typedCallee.type, typedArgs.map(a => a.type), diagnostics, expr.span);
      return { kind: 'apply', callee: typedCallee, args: typedArgs, type: result, span: expr.span };
    }

    case 'asyncCall': {
      // 'f!(args)' — prepare a Task from an async function (whitepaper §8). The
      // callee must be a slot holding an *async* function; the result is a
      // 'Task<result>', not the bare result — nothing runs until 'await'.
      const typedArgs = expr.args.map(arg => synth(arg, env, diagnostics));
      const invalid = (): TypedExpr => ({ kind: 'asyncCall', callee: expr.callee, args: typedArgs, type: INVALID_TYPE, span: expr.span });

      // A built-in async function (the 'prompt' family) — checked against its
      // own signature before falling to a user-defined slot, same priority as
      // FUNCTIONS in the 'call' judgment above.
      const asyncBuiltin = ASYNC_FUNCTIONS[expr.callee];
      if (asyncBuiltin !== undefined) {
        if (typedArgs.some(a => isInvalidType(a.type))) return invalid();
        if (!requireArity(asyncBuiltin.params.length, typedArgs.length, diagnostics, expr.span)) return invalid();
        for (let i = 0; i < asyncBuiltin.params.length; i++) {
          if (!typesEqual(typedArgs[i]!.type, asyncBuiltin.params[i]!)) {
            typeMismatch('T0015', diagnostics, expr.span, asyncBuiltin.params[i]!, typedArgs[i]!.type);
            return invalid();
          }
        }
        return { kind: 'asyncCall', callee: expr.callee, args: typedArgs, type: taskOf(asyncBuiltin.result), span: expr.span };
      }

      const binding = env.get(expr.callee);
      if (binding === null) {
        // An unknown name — the same "no such function" as a by-name call.
        diagnostics.error({ code: 'T0013', span: expr.span, data: { name: expr.callee } });
        return invalid();
      }
      if (isInvalidType(binding.ty)) return invalid();
      // The '!' mark is only for async functions: it prepares a task from one.
      // A plain function (or any non-function) can't be prepared, so this is the
      // mirror of the bare-async error — you wrote '!' where it doesn't belong.
      if (binding.ty.kind !== 'Function' || !binding.ty.async) {
        diagnostics.error({ code: 'T0054', span: expr.span, data: { name: expr.callee, type: typeToString(binding.ty) } });
        return invalid();
      }
      if (typedArgs.some(a => isInvalidType(a.type))) return invalid();

      const result = checkApplication(binding.ty, typedArgs.map(a => a.type), diagnostics, expr.span);
      return { kind: 'asyncCall', callee: expr.callee, args: typedArgs, type: taskOf(result), span: expr.span };
    }

    case 'await': {
      // 'await task' — run a Task and yield its value (whitepaper §8). Legal only
      // in an async context: an 'async fn' body, or the program/REPL top level
      // (its root). In a plain function it is a compile error to mark that
      // function 'async' — the colored model, propagated.
      if (!env.enclosingAsync()) {
        diagnostics.error({ code: 'T0056', span: expr.span });
      }
      const typedTask = synth(expr.task, env, diagnostics);
      const tt = typedTask.type;
      if (isInvalidType(tt)) {
        return { kind: 'await', task: typedTask, type: INVALID_TYPE, span: expr.span };
      }
      // Only a Task can be awaited — it is the sole thing '!' produces, so a
      // non-Task here means you awaited something that was never an async call.
      if (tt.kind !== 'Task') {
        diagnostics.error({ code: 'T0055', span: expr.task.span, data: { actual: typeToString(tt) } });
        return { kind: 'await', task: typedTask, type: INVALID_TYPE, span: expr.span };
      }
      return { kind: 'await', task: typedTask, type: tt.result, span: expr.span };
    }

    case 'fn': {
      // The function's type is formed from its (fully explicit) signature —
      // nothing is inferred from the body (§7). That is what makes recursion
      // need no special case and keeps a signature error local to the signature.
      const paramTypes = expr.params.map(p => typeFromExpr(p.type, env, diagnostics));
      const resultType = typeFromExpr(expr.returnType, env, diagnostics);
      const fnType = functionType(paramTypes, resultType, expr.async);

      // Check the body in a fresh scope with the parameters bound as fixed slots
      // (whitepaper §5 — every parameter is an ordinary fixed slot). The scope
      // also records the declared return type so a 'return' inside resolves it,
      // and the function's async color so an 'await' in the body is legal only
      // when this function is 'async' (whitepaper §8's colored model).
      const bodyEnv = env.childForFunction(resultType, expr.async);
      expr.params.forEach((p, i) => bodyEnv.set(p.name, paramTypes[i]!, 'fix', p.nameSpan));
      const typedBody = inferBlock(expr.body, bodyEnv, diagnostics);

      // The body's value (its last statement, §2) must fit the declared return
      // type. isAssignableTo absorbs Invalid on either side, so a body or return
      // type that already failed doesn't add a second, misleading diagnostic.
      if (!isAssignableTo(typedBody.type, resultType)) {
        diagnostics.error({
          code: 'T0042', span: typedBody.span,
          data: { expected: typeToString(resultType), actual: typeToString(typedBody.type) },
          related: [{ key: 'annotation', span: expr.returnType.span }],
        });
      }

      return {
        kind: 'fn',
        params: expr.params.map((p, i) => ({ name: p.name, type: paramTypes[i]! })),
        body: typedBody,
        captures: freeVariables(expr.body, expr.params),
        async: expr.async,
        type: fnType,
        span: expr.span,
      };
    }

    case 'return': {
      // A 'return' diverges (whitepaper §7), so its own type is always Never —
      // it satisfies any expected type and makes an enclosing block diverge too.
      // Its value must fit the enclosing function's declared return type (the
      // same T0042 the function's fall-through value uses). Outside any function
      // there is nothing to return from (T0043). A bare 'return' yields Done.
      const typedValue = expr.value !== null ? synth(expr.value, env, diagnostics) : null;
      const valueType = typedValue !== null ? typedValue.type : DONE_TYPE;
      const expected = env.enclosingReturn();
      if (expected === null) {
        diagnostics.error({ code: 'T0043', span: expr.span });
      } else if (!isAssignableTo(valueType, expected)) {
        diagnostics.error({
          code: 'T0042', span: (expr.value ?? expr).span,
          data: { expected: typeToString(expected), actual: typeToString(valueType) },
        });
      }
      return { kind: 'return', value: typedValue, returnType: expected ?? INVALID_TYPE, type: NEVER_TYPE, span: expr.span };
    }

    case 'abort': {
      // 'abort "reason"' diverges (whitepaper §7/§9), so its own type is always
      // Never — it satisfies any expected type and makes an enclosing block
      // diverge too. The reason is the only information there is, so it must be a
      // String (T0060); an already-Invalid reason skips the redundant report.
      const typedReason = synth(expr.reason, env, diagnostics);
      if (!isInvalidType(typedReason.type) && !typesEqual(typedReason.type, STRING_TYPE)) {
        diagnostics.error({ code: 'T0060', span: expr.reason.span, data: { actual: typeToString(typedReason.type) } });
      }
      return { kind: 'abort', reason: typedReason, type: NEVER_TYPE, span: expr.span };
    }

    case 'unary': {
      const typedOperand = synth(expr.operand, env, diagnostics);
      if (isInvalidType(typedOperand.type)) {
        return { kind: 'unary', op: expr.op, operand: typedOperand, type: INVALID_TYPE, span: expr.span };
      }
      if (expr.op === 'not') {
        if (typedOperand.type.kind !== 'Bool') {
          const type = operandError(diagnostics, expr.op, expr.span, typedOperand.type);
          return { kind: 'unary', op: expr.op, operand: typedOperand, type, span: expr.span };
        }
        return { kind: 'unary', op: expr.op, operand: typedOperand, type: BOOL_TYPE, span: expr.span };
      }
      if (typedOperand.type.kind !== 'Int' && typedOperand.type.kind !== 'Float') {
        const type = operandError(diagnostics, expr.op, expr.span, typedOperand.type);
        return { kind: 'unary', op: expr.op, operand: typedOperand, type, span: expr.span };
      }
      return { kind: 'unary', op: expr.op, operand: typedOperand, type: typedOperand.type, span: expr.span };
    }

    case 'binary': {
      const typedLeft = synth(expr.left, env, diagnostics);
      const typedRight = synth(expr.right, env, diagnostics);
      const lt = typedLeft.type;
      const rt = typedRight.type;

      let type: AscentType;
      if (isInvalidType(lt) || isInvalidType(rt)) {
        // Bail before any of the operator-specific checks below — every one
        // of them inspects lt/rt's *kind* directly rather than going through
        // an Invalid-aware helper like subtype/leastCommonType, so without
        // this guard an already-reported failure would cascade into a
        // spurious T0008 here.
        type = INVALID_TYPE;
      } else {
        switch (expr.op) {
          case '+': case '-': case '*': case '**': {
            if ((lt.kind !== 'Int' && lt.kind !== 'Float') || (rt.kind !== 'Int' && rt.kind !== 'Float')) {
              type = operandError(diagnostics, expr.op, expr.span, lt, rt);
              break;
            }
            type = (lt.kind === 'Float' || rt.kind === 'Float') ? FLOAT_TYPE : INT_TYPE;
            break;
          }
          case '/': {
            if ((lt.kind !== 'Int' && lt.kind !== 'Float') || (rt.kind !== 'Int' && rt.kind !== 'Float')) {
              type = operandError(diagnostics, expr.op, expr.span, lt, rt);
              break;
            }
            type = FLOAT_TYPE;
            break;
          }
          case 'div': case 'mod': {
            if (lt.kind !== 'Int' || rt.kind !== 'Int') {
              type = operandError(diagnostics, expr.op, expr.span, lt, rt);
              break;
            }
            type = INT_TYPE;
            break;
          }
          case '==': case '!=': {
            // Functions have no equality — comparing them is a compile error
            // (whitepaper §5). Caught here because two identical arrow types
            // otherwise share a common type and would slip through as Bool. A
            // Task is the same: inert running work with no structural sense.
            if (lt.kind === 'Function' || rt.kind === 'Function' || lt.kind === 'Task' || rt.kind === 'Task') {
              type = operandError(diagnostics, expr.op, expr.span, lt, rt);
              break;
            }
            const ct = leastCommonType(lt, rt);
            type = ct === null ? operandError(diagnostics, expr.op, expr.span, lt, rt) : BOOL_TYPE;
            break;
          }
          case '<': case '<=': case '>': case '>=': {
            if ((lt.kind !== 'Int' && lt.kind !== 'Float') || (rt.kind !== 'Int' && rt.kind !== 'Float')) {
              type = operandError(diagnostics, expr.op, expr.span, lt, rt);
              break;
            }
            type = BOOL_TYPE;
            break;
          }
          case 'and':
          case 'or': {
            if (lt.kind !== 'Bool' || rt.kind !== 'Bool') {
              type = operandError(diagnostics, expr.op, expr.span, lt, rt);
              break;
            }
            type = BOOL_TYPE;
            break;
          }
        }
      }
      return { kind: 'binary', op: expr.op, left: typedLeft, right: typedRight, type, span: expr.span };
    }

    case 'coalesce': {
      // 'opt ?? default' (design.md §9). The left must be an Optional — that's
      // the whole point ("seeing '??' tells you the left side is an Optional").
      // A bare 'None' is allowed as the degenerate always-absent case; anything
      // else can never be None, so '??' on it is meaningless (T0044). The result
      // is the least common type of the optional's present value and the default
      // — so `intOpt ?? 3.0` is a Float, just as a list or an 'if' would join.
      const typedLeft = synth(expr.left, env, diagnostics);
      const typedRight = synth(expr.right, env, diagnostics);
      const lt = typedLeft.type;
      const rt = typedRight.type;

      let type: AscentType;
      if (isInvalidType(lt) || isInvalidType(rt)) {
        type = INVALID_TYPE;
      } else if (lt.kind !== 'Optional') {
        diagnostics.error({ code: 'T0044', span: expr.left.span, data: { actual: typeToString(lt) } });
        type = INVALID_TYPE;
      } else {
        // The present-value type is the optional's element — 'Never' for a bare
        // 'None' ('Optional<Never>'), which has no present value, so the default
        // always wins.
        const presentType = lt.elem;
        const joined = leastCommonType(presentType, rt);
        if (joined === null) {
          diagnostics.error({
            code: 'T0045', span: expr.span,
            data: { value: typeToString(presentType), default: typeToString(rt) },
            related: [{ key: 'default', span: expr.right.span }],
          });
          type = INVALID_TYPE;
        } else {
          type = joined;
        }
      }
      return { kind: 'coalesce', left: typedLeft, right: typedRight, type, span: expr.span };
    }

    case 'list': {
      if (expr.elements.length === 0) {
        // No context to take a type from — design.md §7: an empty list has
        // no elements to infer T from, so it's List<Never> (Never widens to
        // any T), not an error. This is what lets '[].append(1)' infer
        // List<Int> on its own, and a slot declared from a bare '[]' still
        // needs an annotation (checked below in the fix/mut case) since
        // otherwise its type would freeze at the un-widenable List<Never>.
        // An expectation to adopt instead (e.g. 'fix xs: List<Int> = []')
        // is `check`'s job, not synth's.
        return { kind: 'list', elements: [], type: listOfType(NEVER_TYPE), span: expr.span };
      }

      // No upfront "any element Invalid" guard needed here (unlike call/
      // methodCall/etc.): joinElementTypes routes entirely through
      // leastCommonType, which already propagates Invalid on its own.
      const typedElements = expr.elements.map(el => synth(el, env, diagnostics));
      const elemType = joinElementTypes(typedElements, expr.span, diagnostics);
      return { kind: 'list', elements: typedElements, type: listOfType(elemType), span: expr.span };
    }

    case 'range': {
      const typedLo = synth(expr.lo, env, diagnostics);
      const typedHi = synth(expr.hi, env, diagnostics);
      if (isInvalidType(typedLo.type) || isInvalidType(typedHi.type)) {
        return { kind: 'range', lo: typedLo, hi: typedHi, type: INVALID_TYPE, span: expr.span };
      }
      // Both bounds must be Int — a Range counts whole steps (design.md §4).
      // Point at the first bound that isn't; if the low bound is fine, the
      // high one is the culprit.
      if (typedLo.type.kind !== 'Int' || typedHi.type.kind !== 'Int') {
        const bad = typedLo.type.kind !== 'Int' ? typedLo : typedHi;
        diagnostics.error({ code: 'T0020', span: bad.span, data: { actual: typeToString(bad.type) } });
        return { kind: 'range', lo: typedLo, hi: typedHi, type: INVALID_TYPE, span: expr.span };
      }
      return { kind: 'range', lo: typedLo, hi: typedHi, type: RANGE_TYPE, span: expr.span };
    }

    case 'index': {
      const typedList = synth(expr.list, env, diagnostics);
      const typedIndex = synth(expr.index, env, diagnostics);
      if (isInvalidType(typedList.type) || isInvalidType(typedIndex.type)) {
        return { kind: 'index', list: typedList, index: typedIndex, type: INVALID_TYPE, span: expr.span };
      }
      if (typedList.type.kind !== 'List') {
        diagnostics.error({ code: 'T0006', span: expr.list.span, data: { actual: typeToString(typedList.type) } });
        return { kind: 'index', list: typedList, index: typedIndex, type: INVALID_TYPE, span: expr.span };
      }
      if (typedIndex.type.kind !== 'Int') {
        diagnostics.error({ code: 'T0007', span: expr.index.span, data: { actual: typeToString(typedIndex.type) } });
        return { kind: 'index', list: typedList, index: typedIndex, type: INVALID_TYPE, span: expr.span };
      }
      return { kind: 'index', list: typedList, index: typedIndex, type: typedList.type.elem, span: expr.span };
    }

    case 'methodCall': {
      // Namespace-qualified access: 'math.min(…)' where 'math' is a namespace
      // import. It resolves to the same 'call' node a named import produces (so
      // the interpreter dispatches every stdlib call one way) — checked BEFORE
      // synthesizing the receiver, since 'math' is a module, not a value, and
      // synthesizing it as a slot would wrongly report an unknown name.
      if (expr.receiver.kind === 'slot') {
        const nsModule = env.getNamespace(expr.receiver.name);
        if (nsModule !== null) return synthNamespaceCall(nsModule, expr, env, diagnostics);
      }

      const typedReceiver = synth(expr.receiver, env, diagnostics);
      const typedArgs = expr.args.map(arg => synth(arg, env, diagnostics));
      if (isInvalidType(typedReceiver.type) || typedArgs.some(a => isInvalidType(a.type))) {
        return {
          kind: 'methodCall', receiver: typedReceiver, method: expr.method,
          args: typedArgs, type: INVALID_TYPE, span: expr.span,
        };
      }

      const argTypes = typedArgs.map(a => a.type);
      const resultType = methodCallType(typedReceiver.type, expr.method, argTypes, diagnostics, expr.span);
      return {
        kind: 'methodCall', receiver: typedReceiver, method: expr.method,
        args: typedArgs, type: resultType, span: expr.span,
      };
    }

    case 'construct': {
      // 'Success{ … }' / 'Failure{ … }' are the built-in Result constructors,
      // not user-declared types, so they're handled before the ordinary lookup.
      if (expr.typeName === 'Success' || expr.typeName === 'Failure') {
        return synthResultConstruct(expr, expr.typeName, env, diagnostics);
      }
      // A construction names a *constructor* (a variant tag), which for a record
      // equals the type name and for a union is one of its variants ('Circle').
      const ctor = env.getConstructor(expr.typeName);
      if (ctor === null) {
        // The name isn't a constructor. Three ways that happens: it's a declared
        // *type* but multi-variant (a single-variant type registers its own name
        // as a constructor), so you build one of its variants (N0011); it's a
        // built-in type (Int, List, …), which is a shape, not a value (N0012);
        // or there's simply no such type (N0005). Either way, still synth every
        // field value so independent errors inside them surface (nothing here
        // can widen or adopt without a declared field).
        const asType = env.getType(expr.typeName);
        if (asType !== null) {
          diagnostics.error({ code: 'N0011', span: expr.typeNameSpan, data: { name: expr.typeName, variants: asType.variants.map(v => v.tag).join(', ') } });
        } else if (BUILTIN_TYPE_NAMES.has(expr.typeName)) {
          diagnostics.error({ code: 'N0012', span: expr.typeNameSpan, data: { name: expr.typeName } });
        } else {
          diagnostics.error({ code: 'N0005', span: expr.typeNameSpan, data: { name: expr.typeName } });
        }
        const typedFields = expr.fields.map(f => ({ name: f.name, declaredType: INVALID_TYPE, value: synth(f.value, env, diagnostics) }));
        return { kind: 'construct', typeName: expr.typeName, fields: typedFields, type: INVALID_TYPE, span: expr.span };
      }

      // The value's type is the whole union (namedType(info.name), e.g. 'Shape'),
      // even though we built one variant ('Circle') — that variant's fields are
      // what the provided fields are checked against.
      const declaredFields = ctor.variant.fields;
      const declaredNames = new Set(declaredFields.map(d => d.name));

      // A zero-field variant is written bare ('Red'), never 'Red{}' — empty
      // braces are banned (S0023), the one-spelling rule. This is the only
      // place the check can live: 'Circle{}' looks identical but its variant
      // *does* declare fields, so it's a missing-field mistake (T0022), not this
      // one. Reported here; the build itself is otherwise fine, so we carry on.
      if (expr.braces && declaredFields.length === 0 && expr.fields.length === 0) {
        diagnostics.error({ code: 'S0023', span: expr.span });
      }

      // Pass 1: record the first init for each field name, and flag the
      // provided fields that won't be checked in pass 2 — a duplicate (T0024)
      // or a name the type doesn't declare (T0023). Those still get synth'd so
      // errors inside them aren't lost; declared fields wait for the checked
      // pass so they can widen/adopt against their declared type.
      const provided = new Map<string, FieldInit>();
      for (const f of expr.fields) {
        if (provided.has(f.name)) {
          diagnostics.error({ code: 'T0024', span: f.nameSpan, data: { field: f.name, type: expr.typeName } });
          synth(f.value, env, diagnostics);
          continue;
        }
        provided.set(f.name, f);
        if (!declaredNames.has(f.name)) {
          diagnostics.error({ code: 'T0023', span: f.nameSpan, data: { field: f.name, type: expr.typeName } });
          synth(f.value, env, diagnostics);
        }
      }

      // Pass 2: walk the declared fields in order, checking each provided value
      // against its declared type (so an Int widens to a Float field, a bare
      // '[]' adopts a List field's element type). A field with no init is
      // missing. Declaration order is the node's canonical field order.
      const typedFields: TypedFieldInit[] = [];
      const missing: string[] = [];
      for (const decl of declaredFields) {
        const init = provided.get(decl.name);
        if (init === undefined) {
          missing.push(decl.name);
          continue;
        }
        const value = check(init.value, decl.type, env, diagnostics, [{ key: 'field', span: decl.span }], 'T0025');
        typedFields.push({ name: decl.name, declaredType: decl.type, value });
      }
      if (missing.length > 0) {
        diagnostics.error({ code: 'T0022', span: expr.typeNameSpan, data: { type: expr.typeName, fields: missing.join(', ') } });
      }

      return { kind: 'construct', typeName: expr.typeName, fields: typedFields, type: namedType(ctor.info.name), span: expr.span };
    }

    case 'with': {
      const typedBase = synth(expr.base, env, diagnostics);

      // 'its' refers to the base inside every index and value expression — a
      // contextual keyword (§6, special only here), bound as an ordinary slot in
      // a child scope those expressions are checked in.
      const childEnv = env.child();
      childEnv.set('its', typedBase.type, 'fix', null);

      // Two updates writing the *same* statically-known path can't both win. A
      // path with a computed index has no static key (pathKey → null), so it's
      // never flagged — we can't decide whether '[i]' and '[j]' collide.
      const seen = new Set<string>();

      const typedUpdates: TypedWithUpdate[] = expr.updates.map(u => {
        // Walk the path from the base type, mirroring how the same path *reads*
        // (whitepaper §6 — "the update path is the read path") but reporting in
        // terms of the *update*: a '.field' step needs a record (a list wants
        // '[index]' → T0038, a union wants 'match' → T0036, anything else has no
        // fields → T0035; an unknown field is T0037); an '[index]' step needs a
        // list (a record wants a field name → T0039, a union 'match' → T0036,
        // anything else can't be indexed → T0035). These fire at any depth, so a
        // beginner sees the same guidance for 'users.city' as for the base. A
        // step that fails poisons `current` to Invalid, which then absorbs the
        // value check with no cascade; `leafFieldSpan` is a *final* field step's
        // declaration span (for the value-mismatch related pointer).
        let current = typedBase.type;
        let currentSpan = expr.base.span;
        let leafFieldSpan: Span | null = null;
        const typedPath: TypedPathStep[] = [];

        for (const step of u.path) {
          if (step.kind === 'field') {
            leafFieldSpan = null;
            if (isInvalidType(current)) {
              // Upstream already reported; keep walking to shape the typed node.
            } else if (current.kind === 'List') {
              diagnostics.error({ code: 'T0038', span: step.fieldSpan, data: { field: step.field } });
              current = INVALID_TYPE;
            } else if (current.kind !== 'Named') {
              diagnostics.error({ code: 'T0035', span: currentSpan, data: { type: typeToString(current) } });
              current = INVALID_TYPE;
            } else {
              const info = env.getType(current.name);
              if (info !== null && info.variants.length !== 1) {
                diagnostics.error({ code: 'T0036', span: currentSpan, data: { type: info.name, variants: info.variants.map(v => v.tag).join(', ') } });
                current = INVALID_TYPE;
              } else {
                const field = info?.variants[0]?.fields.find(f => f.name === step.field);
                if (field === undefined) {
                  diagnostics.error({ code: 'T0037', span: step.fieldSpan, data: { field: step.field, type: current.name } });
                  current = INVALID_TYPE;
                } else {
                  current = field.type;
                  leafFieldSpan = field.span;
                }
              }
            }
            typedPath.push({ kind: 'field', field: step.field });
            currentSpan = step.span;
          } else {
            const typedIndex = synth(step.index, childEnv, diagnostics);
            leafFieldSpan = null;
            if (isInvalidType(current)) {
              // Upstream already reported.
            } else if (current.kind === 'List') {
              if (!isInvalidType(typedIndex.type) && typedIndex.type.kind !== 'Int') {
                diagnostics.error({ code: 'T0007', span: step.index.span, data: { actual: typeToString(typedIndex.type) } });
              }
              current = current.elem;
            } else if (current.kind === 'Named') {
              const info = env.getType(current.name);
              if (info !== null && info.variants.length !== 1) {
                diagnostics.error({ code: 'T0036', span: currentSpan, data: { type: info.name, variants: info.variants.map(v => v.tag).join(', ') } });
              } else {
                diagnostics.error({ code: 'T0039', span: step.span, data: { type: current.name } });
              }
              current = INVALID_TYPE;
            } else {
              diagnostics.error({ code: 'T0035', span: currentSpan, data: { type: typeToString(current) } });
              current = INVALID_TYPE;
            }
            typedPath.push({ kind: 'index', index: typedIndex });
            currentSpan = step.span;
          }
        }

        // Flag a repeat of a statically-known path (T0041) — the update is an
        // error, so the program won't run; every update is still checked.
        const key = pathKey(u.path);
        if (key !== null) {
          if (seen.has(key)) diagnostics.error({ code: 'T0041', span: u.span, data: { path: pathDisplay(u.path) } });
          else seen.add(key);
        }

        // Check the new value against the leaf position's type — an Int widens to
        // a Float field/element, a bare '[]' adopts a List's element type, all as
        // a construction field (T0025) does. The last step's kind picks the code:
        // a field leaf reports T0025, a list-element leaf T0040.
        const lastKind = u.path[u.path.length - 1]!.kind;
        const related = leafFieldSpan !== null ? [{ key: 'field', span: leafFieldSpan }] : [];
        const value = check(u.value, current, childEnv, diagnostics, related, lastKind === 'field' ? 'T0025' : 'T0040');

        return { path: typedPath, declaredType: current, value };
      });

      // The value's type is the base's, unchanged — a copy with some positions
      // replaced is the same record/list type.
      return { kind: 'with', base: typedBase, updates: typedUpdates, type: typedBase.type, span: expr.span };
    }

    case 'fieldAccess': {
      const typedReceiver = synth(expr.receiver, env, diagnostics);
      if (isInvalidType(typedReceiver.type)) {
        return { kind: 'fieldAccess', receiver: typedReceiver, field: expr.field, type: INVALID_TYPE, span: expr.span };
      }
      // Field access needs a value with fields to read. A non-Named type has
      // none (T0026); a Named type does, but only a *record* (one variant) — a
      // multi-variant union has no single field set, so '.field' on one is
      // T0028 (its cases are told apart with 'match', not a field read).
      if (typedReceiver.type.kind !== 'Named') {
        diagnostics.error({ code: 'T0026', span: expr.receiver.span, data: { type: typeToString(typedReceiver.type) } });
        return { kind: 'fieldAccess', receiver: typedReceiver, field: expr.field, type: INVALID_TYPE, span: expr.span };
      }
      const info = env.getType(typedReceiver.type.name);
      if (info !== null && info.variants.length !== 1) {
        diagnostics.error({ code: 'T0028', span: expr.receiver.span, data: { type: info.name, variants: info.variants.map(v => v.tag).join(', ') } });
        return { kind: 'fieldAccess', receiver: typedReceiver, field: expr.field, type: INVALID_TYPE, span: expr.span };
      }
      const field = info?.variants[0]?.fields.find(f => f.name === expr.field);
      if (field === undefined) {
        diagnostics.error({ code: 'T0027', span: expr.fieldSpan, data: { field: expr.field, type: typedReceiver.type.name } });
        return { kind: 'fieldAccess', receiver: typedReceiver, field: expr.field, type: INVALID_TYPE, span: expr.span };
      }
      return { kind: 'fieldAccess', receiver: typedReceiver, field: expr.field, type: field.type, span: expr.span };
    }

    case 'block':
      return inferBlock(expr, env, diagnostics);

    case 'if':
      return inferIf(expr, env, diagnostics);

    case 'match':
      return inferMatch(expr, env, diagnostics);

    case 'try':
      return synthTry(expr, env, diagnostics);
  }
};
