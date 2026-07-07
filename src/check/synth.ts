import type { Expr, FieldInit } from '../parser/ast.js';
import type { Span } from '../lexer/token.js';
import type { TypedExpr, TypedTemplatePart, TypedFieldInit } from '../parser/typed-ast.js';
import {
  AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, NONE_TYPE, DONE_TYPE, NEVER_TYPE, INVALID_TYPE, RANGE_TYPE,
  listOfType, leastCommonType, typeToString, typesEqual, isScalarType, isInvalidType, namedType,
} from '../types/types.js';
import type { TypeEnv } from './env.js';
import { Diagnostics, requireArity, typeMismatch, operandError } from './diagnostics.js';
import { methodCallType, FUNCTIONS } from './signatures.js';
import { inferBlock, inferIf } from './stmt.js';
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
        if (!isInvalidType(typedHole.type) && !isScalarType(typedHole.type)) {
          diagnostics.error({ code: 'T0014', span: part.expr.span, data: { actual: typeToString(typedHole.type) } });
        }
        typedParts.push({ kind: 'hole', expr: typedHole });
      }
      return { kind: 'template', parts: typedParts, type: STRING_TYPE, span: expr.span };
    }

    case 'slot': {
      const binding = env.get(expr.name);
      if (binding === null) {
        diagnostics.error({ code: 'N0001', span: expr.span });
        return { ...expr, type: INVALID_TYPE };
      }
      return { ...expr, type: binding.ty };
    }

    case 'call': {
      const sig = FUNCTIONS[expr.callee];
      if (sig === undefined) {
        diagnostics.error({ code: 'T0013', span: expr.span, data: { name: expr.callee } });
        // Still synthesize the args so any independent errors inside them
        // are reported too, even though there's no signature to check them
        // against.
        const typedArgs = expr.args.map(arg => synth(arg, env, diagnostics));
        return { kind: 'call', callee: expr.callee, args: typedArgs, type: INVALID_TYPE, span: expr.span };
      }

      const typedArgs = expr.args.map(arg => synth(arg, env, diagnostics));
      // Any argument that already failed poisons the whole call (Rule 2) —
      // don't also run arity/type checks against it.
      if (typedArgs.some(a => isInvalidType(a.type))) {
        return { kind: 'call', callee: expr.callee, args: typedArgs, type: INVALID_TYPE, span: expr.span };
      }

      if (!requireArity(sig.params.length, typedArgs.length, diagnostics, expr.span)) {
        return { kind: 'call', callee: expr.callee, args: typedArgs, type: INVALID_TYPE, span: expr.span };
      }
      for (let i = 0; i < sig.params.length; i++) {
        if (!typesEqual(typedArgs[i]!.type, sig.params[i]!)) {
          const type = typeMismatch('T0008', diagnostics, expr.span, sig.params[i]!, typedArgs[i]!.type);
          return { kind: 'call', callee: expr.callee, args: typedArgs, type, span: expr.span };
        }
      }
      return { kind: 'call', callee: expr.callee, args: typedArgs, type: sig.result, span: expr.span };
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
      const info = env.getType(expr.typeName);
      if (info === null) {
        // No such type — N0005. Still synth every field value so independent
        // errors inside them surface (there's no declared type to check
        // against, so nothing here can widen or adopt).
        diagnostics.error({ code: 'N0005', span: expr.typeNameSpan, data: { name: expr.typeName } });
        const typedFields = expr.fields.map(f => ({ name: f.name, declaredType: INVALID_TYPE, value: synth(f.value, env, diagnostics) }));
        return { kind: 'construct', typeName: expr.typeName, fields: typedFields, type: INVALID_TYPE, span: expr.span };
      }

      // A record is the sole variant (design.md §6's single-variant sugar).
      const declaredFields = info.variants[0]!.fields;
      const declaredNames = new Set(declaredFields.map(d => d.name));

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

      return { kind: 'construct', typeName: expr.typeName, fields: typedFields, type: namedType(expr.typeName), span: expr.span };
    }

    case 'fieldAccess': {
      const typedReceiver = synth(expr.receiver, env, diagnostics);
      if (isInvalidType(typedReceiver.type)) {
        return { kind: 'fieldAccess', receiver: typedReceiver, field: expr.field, type: INVALID_TYPE, span: expr.span };
      }
      // Field access is legal only on a record (design.md §6 — and, once unions
      // exist, only on a single-variant one; every Named type is single-variant
      // today). Anything else has no fields to read.
      if (typedReceiver.type.kind !== 'Named') {
        diagnostics.error({ code: 'T0022', span: expr.receiver.span, data: { type: typeToString(typedReceiver.type) } });
        return { kind: 'fieldAccess', receiver: typedReceiver, field: expr.field, type: INVALID_TYPE, span: expr.span };
      }
      const info = env.getType(typedReceiver.type.name);
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
  }
};
