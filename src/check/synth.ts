import type { Expr, FieldInit } from '../parser/ast.js';
import type { Span } from '../lexer/token.js';
import type { TypedExpr, TypedTemplatePart, TypedFieldInit } from '../parser/typed-ast.js';
import {
  AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, NONE_TYPE, DONE_TYPE, NEVER_TYPE, INVALID_TYPE, RANGE_TYPE,
  listOfType, leastCommonType, typeToString, isInvalidType, namedType, functionType, isAssignableTo,
} from '../types/types.js';
import type { TypeEnv } from './env.js';
import { Diagnostics, requireArity, typeMismatch, operandError } from './diagnostics.js';
import { methodCallType, FUNCTIONS, paramAccepts, isTraitBound } from './signatures.js';
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
// the first — T0002 when two elements share no common supertype. Shared by
// synth (the result is the list's type, as-is) and check (which may still
// widen the result further toward an expected element type). leastCommonType
// is already Invalid-aware, so an element that failed on its own quietly
// carries Invalid through the join without a second diagnostic here.
export const joinElementTypes = (typedElements: TypedExpr[], span: Span, diagnostics: Diagnostics): AscentType => {
  let elemType: AscentType = typedElements[0]!.type;
  for (const te of typedElements.slice(1)) {
    const ct = leastCommonType(elemType, te.type);
    if (ct === null) {
      diagnostics.error({
        code: 'T0002', span,
        data: { first: typeToString(elemType), other: typeToString(te.type) },
        related: [{ key: 'element', span: te.span }],
      });
      return INVALID_TYPE;
    }
    elemType = ct;
  }
  return elemType;
};

// Check a call's arguments against a function type: arity (T0007), then each
// argument assignable to its parameter (T0008 — assignable, not exact, so an Int
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
      return typeMismatch('T0008', diagnostics, span, fn.params[i]!, argTypes[i]!);
    }
  }
  return fn.result;
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
    // an already-Invalid hole just skips the redundant T0014 (its own
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
          diagnostics.error({ code: 'T0014', span: part.expr.span, data: { actual: typeToString(typedHole.type) } });
        }
        typedParts.push({ kind: 'hole', expr: typedHole });
      }
      return { kind: 'template', parts: typedParts, type: STRING_TYPE, span: expr.span };
    }

    case 'slot': {
      const binding = env.get(expr.name);
      if (binding === null) {
        // A bare built-in function name (print) in value position, not a call:
        // it has no first-class type yet (its trait bound can't be written as a
        // type), so this is a clearer error than "undefined name". A call
        // 'print(x)' never reaches here — it's a 'call' node, not a 'slot'.
        const code = FUNCTIONS[expr.name] !== undefined ? 'N0013' : 'N0001';
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
            // mismatch (T0008); an unmet trait bound (only print's Display today)
            // has no single "expected type" to name, so it gets its own message.
            if (isTraitBound(param)) {
              diagnostics.error({ code: 'T0024', span: expr.span, data: { actual: typeToString(argType) } });
            } else {
              typeMismatch('T0008', diagnostics, expr.span, param, argType);
            }
            return invalid();
          }
        }
        return { kind: 'call', callee: expr.callee, args: typedArgs, type: builtin.result, span: expr.span };
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
        diagnostics.error({ code: 'T0035', span: expr.span, data: { name: expr.callee, type: typeToString(binding.ty) } });
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
        // (T0038 — the nameless twin of T0035 for a by-name call).
        diagnostics.error({ code: 'T0038', span: expr.callee.span, data: { type: typeToString(typedCallee.type) } });
        return invalid();
      }
      const result = checkApplication(typedCallee.type, typedArgs.map(a => a.type), diagnostics, expr.span);
      return { kind: 'apply', callee: typedCallee, args: typedArgs, type: result, span: expr.span };
    }

    case 'fn': {
      // The function's type is formed from its (fully explicit) signature —
      // nothing is inferred from the body (§7). That is what makes recursion
      // need no special case and keeps a signature error local to the signature.
      const paramTypes = expr.params.map(p => typeFromExpr(p.type, env, diagnostics));
      const resultType = typeFromExpr(expr.returnType, env, diagnostics);
      const fnType = functionType(paramTypes, resultType);

      // Check the body in a fresh scope with the parameters bound as fixed slots
      // (whitepaper §5 — every parameter is an ordinary fixed slot). The scope
      // also records the declared return type so a 'return' inside resolves it.
      const bodyEnv = env.childForFunction(resultType);
      expr.params.forEach((p, i) => bodyEnv.set(p.name, paramTypes[i]!, 'fix', p.nameSpan));
      const typedBody = inferBlock(expr.body, bodyEnv, diagnostics);

      // The body's value (its last statement, §2) must fit the declared return
      // type. isAssignableTo absorbs Invalid on either side, so a body or return
      // type that already failed doesn't add a second, misleading diagnostic.
      if (!isAssignableTo(typedBody.type, resultType)) {
        diagnostics.error({
          code: 'T0036', span: typedBody.span,
          data: { expected: typeToString(resultType), actual: typeToString(typedBody.type) },
          related: [{ key: 'annotation', span: expr.returnType.span }],
        });
      }

      return {
        kind: 'fn',
        params: expr.params.map((p, i) => ({ name: p.name, type: paramTypes[i]! })),
        body: typedBody,
        captures: freeVariables(expr.body, expr.params),
        type: fnType,
        span: expr.span,
      };
    }

    case 'return': {
      // A 'return' diverges (whitepaper §7), so its own type is always Never —
      // it satisfies any expected type and makes an enclosing block diverge too.
      // Its value must fit the enclosing function's declared return type (the
      // same T0036 the function's fall-through value uses). Outside any function
      // there is nothing to return from (T0037). A bare 'return' yields Done.
      const typedValue = expr.value !== null ? synth(expr.value, env, diagnostics) : null;
      const valueType = typedValue !== null ? typedValue.type : DONE_TYPE;
      const expected = env.enclosingReturn();
      if (expected === null) {
        diagnostics.error({ code: 'T0037', span: expr.span });
      } else if (!isAssignableTo(valueType, expected)) {
        diagnostics.error({
          code: 'T0036', span: (expr.value ?? expr).span,
          data: { expected: typeToString(expected), actual: typeToString(valueType) },
        });
      }
      return { kind: 'return', value: typedValue, returnType: expected ?? INVALID_TYPE, type: NEVER_TYPE, span: expr.span };
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
        // spurious T0009 here.
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
            // otherwise share a common type and would slip through as Bool.
            if (lt.kind === 'Function' || rt.kind === 'Function') {
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
      // else can never be None, so '??' on it is meaningless (T0039). The result
      // is the least common type of the optional's present value and the default
      // — so `intOpt ?? 3.0` is a Float, just as a list or an 'if' would join.
      const typedLeft = synth(expr.left, env, diagnostics);
      const typedRight = synth(expr.right, env, diagnostics);
      const lt = typedLeft.type;
      const rt = typedRight.type;

      let type: AscentType;
      if (isInvalidType(lt) || isInvalidType(rt)) {
        type = INVALID_TYPE;
      } else if (lt.kind !== 'Optional' && lt.kind !== 'None') {
        diagnostics.error({ code: 'T0039', span: expr.left.span, data: { actual: typeToString(lt) } });
        type = INVALID_TYPE;
      } else {
        // The present-value type: an Optional's element, or Never for a bare
        // None (which has no present value, so the default always wins).
        const presentType = lt.kind === 'Optional' ? lt.elem : NEVER_TYPE;
        const joined = leastCommonType(presentType, rt);
        if (joined === null) {
          diagnostics.error({
            code: 'T0040', span: expr.span,
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
        diagnostics.error({ code: 'T0016', span: bad.span, data: { actual: typeToString(bad.type) } });
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
        diagnostics.error({ code: 'T0010', span: expr.list.span, data: { actual: typeToString(typedList.type) } });
        return { kind: 'index', list: typedList, index: typedIndex, type: INVALID_TYPE, span: expr.span };
      }
      if (typedIndex.type.kind !== 'Int') {
        diagnostics.error({ code: 'T0011', span: expr.index.span, data: { actual: typeToString(typedIndex.type) } });
        return { kind: 'index', list: typedList, index: typedIndex, type: INVALID_TYPE, span: expr.span };
      }
      return { kind: 'index', list: typedList, index: typedIndex, type: typedList.type.elem, span: expr.span };
    }

    case 'methodCall': {
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
      // braces are banned (S0028), the one-spelling rule. This is the only
      // place the check can live: 'Circle{}' looks identical but its variant
      // *does* declare fields, so it's a missing-field mistake (T0018), not this
      // one. Reported here; the build itself is otherwise fine, so we carry on.
      if (expr.braces && declaredFields.length === 0 && expr.fields.length === 0) {
        diagnostics.error({ code: 'S0028', span: expr.span });
      }

      // Pass 1: record the first init for each field name, and flag the
      // provided fields that won't be checked in pass 2 — a duplicate (T0020)
      // or a name the type doesn't declare (T0019). Those still get synth'd so
      // errors inside them aren't lost; declared fields wait for the checked
      // pass so they can widen/adopt against their declared type.
      const provided = new Map<string, FieldInit>();
      for (const f of expr.fields) {
        if (provided.has(f.name)) {
          diagnostics.error({ code: 'T0020', span: f.nameSpan, data: { field: f.name, type: expr.typeName } });
          synth(f.value, env, diagnostics);
          continue;
        }
        provided.set(f.name, f);
        if (!declaredNames.has(f.name)) {
          diagnostics.error({ code: 'T0019', span: f.nameSpan, data: { field: f.name, type: expr.typeName } });
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
        const value = check(init.value, decl.type, env, diagnostics, [{ key: 'field', span: decl.span }], 'T0021');
        typedFields.push({ name: decl.name, declaredType: decl.type, value });
      }
      if (missing.length > 0) {
        diagnostics.error({ code: 'T0018', span: expr.typeNameSpan, data: { type: expr.typeName, fields: missing.join(', ') } });
      }

      return { kind: 'construct', typeName: expr.typeName, fields: typedFields, type: namedType(ctor.info.name), span: expr.span };
    }

    case 'fieldAccess': {
      const typedReceiver = synth(expr.receiver, env, diagnostics);
      if (isInvalidType(typedReceiver.type)) {
        return { kind: 'fieldAccess', receiver: typedReceiver, field: expr.field, type: INVALID_TYPE, span: expr.span };
      }
      // Field access needs a value with fields to read. A non-Named type has
      // none (T0022); a Named type does, but only a *record* (one variant) — a
      // multi-variant union has no single field set, so '.field' on one is
      // T0032 (its cases are told apart with 'match', not a field read).
      if (typedReceiver.type.kind !== 'Named') {
        diagnostics.error({ code: 'T0022', span: expr.receiver.span, data: { type: typeToString(typedReceiver.type) } });
        return { kind: 'fieldAccess', receiver: typedReceiver, field: expr.field, type: INVALID_TYPE, span: expr.span };
      }
      const info = env.getType(typedReceiver.type.name);
      if (info !== null && info.variants.length !== 1) {
        diagnostics.error({ code: 'T0032', span: expr.receiver.span, data: { type: info.name, variants: info.variants.map(v => v.tag).join(', ') } });
        return { kind: 'fieldAccess', receiver: typedReceiver, field: expr.field, type: INVALID_TYPE, span: expr.span };
      }
      const field = info?.variants[0]?.fields.find(f => f.name === expr.field);
      if (field === undefined) {
        diagnostics.error({ code: 'T0023', span: expr.fieldSpan, data: { field: expr.field, type: typedReceiver.type.name } });
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
  }
};
