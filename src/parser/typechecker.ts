import type { Expr, Statement, Program, Block, If, TypeExpr } from './ast.js';
import type { Marker, Span } from '../lexer/token.js';
import type { TypedExpr, TypedBlock, TypedIf, TypedStatement, TypedProgram } from './typed-ast.js';
import {
  Type, INT, FLOAT, BOOL, STRING, NONE, DONE, listOf,
  leastCommonType, isAssignableTo,
} from './types.js';

export interface TypeCheckResult {
  typedProgram: TypedProgram | null;
  errorMarkers: Marker[];
}

// A chain of scopes mirroring Environment in the interpreter.
class TypeEnv {
  private vars = new Map<string, { ty: Type; mutable: boolean }>();
  public constructor(private readonly parent: TypeEnv | null = null) { }

  public get(name: string): { ty: Type; mutable: boolean } | null {
    return this.vars.get(name) ?? this.parent?.get(name) ?? null;
  }

  public set(name: string, ty: Type, mutable: boolean): void {
    this.vars.set(name, { ty, mutable });
  }

  public child(): TypeEnv {
    return new TypeEnv(this);
  }
}

const resolveTypeExpr = (te: TypeExpr): Type => {
  switch (te.kind) {
    case 'TypeName': {
      switch (te.name) {
        case 'Int': return INT;
        case 'Float': return FLOAT;
        case 'Bool': return BOOL;
        case 'String': return STRING;
      }
    }
    case 'ListType':
      return listOf(resolveTypeExpr(te.elem));
  }
};

// ---- Method type signatures ------------------------------------------

const requireArity = (expected: number, got: number, markers: Marker[], span: Span): boolean => {
  if (got !== expected) { markers.push({ code: 'T0007', span }); return false; }
  return true;
};

const intMethodType = (method: string, argTypes: Type[], markers: Marker[], span: Span): Type | null => {
  switch (method) {
    case 'toStr': return requireArity(0, argTypes.length, markers, span) ? STRING : null;
    case 'toFloat': return requireArity(0, argTypes.length, markers, span) ? FLOAT : null;
    case 'abs': return requireArity(0, argTypes.length, markers, span) ? INT : null;
    default: markers.push({ code: 'T0006', span }); return null;
  }
};

const floatMethodType = (method: string, argTypes: Type[], markers: Marker[], span: Span): Type | null => {
  switch (method) {
    case 'toStr': return requireArity(0, argTypes.length, markers, span) ? STRING : null;
    case 'toInt': return requireArity(0, argTypes.length, markers, span) ? INT : null;
    case 'abs': return requireArity(0, argTypes.length, markers, span) ? FLOAT : null;
    case 'min':
    case 'max': {
      if (!requireArity(1, argTypes.length, markers, span)) return null;
      const arg = argTypes[0]!;
      if (arg.kind !== 'Int' && arg.kind !== 'Float') { markers.push({ code: 'T0008', span }); return null; }
      return FLOAT;
    }
    default: markers.push({ code: 'T0006', span }); return null;
  }
};

const listMethodType = (
  elemType: Type, method: string, argTypes: Type[], markers: Marker[], span: Span,
): Type | null => {
  switch (method) {
    case 'length': return requireArity(0, argTypes.length, markers, span) ? INT : null;
    case 'isEmpty': return requireArity(0, argTypes.length, markers, span) ? BOOL : null;
    case 'reverse': return requireArity(0, argTypes.length, markers, span) ? listOf(elemType) : null;
    case 'append':
    case 'prepend': {
      if (!requireArity(1, argTypes.length, markers, span)) return null;
      const ct = leastCommonType(elemType, argTypes[0]!);
      if (ct === null) { markers.push({ code: 'T0008', span }); return null; }
      return listOf(ct);
    }
    case 'concat': {
      if (!requireArity(1, argTypes.length, markers, span)) return null;
      const arg = argTypes[0]!;
      if (arg.kind !== 'List') { markers.push({ code: 'T0008', span }); return null; }
      const ct = leastCommonType(elemType, arg.elem);
      if (ct === null) { markers.push({ code: 'T0008', span }); return null; }
      return listOf(ct);
    }
    default: markers.push({ code: 'T0006', span }); return null;
  }
};

// ---- Expression inference -------------------------------------------
//
// Returns a TypedExpr with the inferred type embedded, or null when
// inference fails (error already recorded in markers). Callers that
// get null should still continue checking siblings to surface more errors.

const inferExpr = (
  expr: Expr, env: TypeEnv, markers: Marker[], contextType: Type | null = null,
): TypedExpr | null => {
  switch (expr.kind) {
    case 'literal': {
      switch (expr.type) {
        case 'Int': return { ...expr, ty: INT };
        case 'Float': return { ...expr, ty: FLOAT };
        case 'Bool': return { ...expr, ty: BOOL };
        case 'String': return { ...expr, ty: STRING };
        case 'None': return { ...expr, ty: NONE };
        case 'Done': return { ...expr, ty: DONE };
      }
    }

    case 'slot': {
      const binding = env.get(expr.name);
      if (binding === null) { markers.push({ code: 'N0001', span: expr.span }); return null; }
      return { ...expr, ty: binding.ty };
    }

    case 'call': {
      // floor is the only built-in for now.
      if (expr.callee !== 'floor') { markers.push({ code: 'T0006', span: expr.span }); return null; }
      if (!requireArity(1, expr.args.length, markers, expr.span)) return null;
      const typedArg = inferExpr(expr.args[0]!, env, markers);
      if (typedArg === null) return null;
      if (typedArg.ty.kind !== 'Float') { markers.push({ code: 'T0008', span: expr.span }); return null; }
      return { kind: 'call', callee: expr.callee, args: [typedArg], ty: FLOAT, span: expr.span };
    }

    case 'unary': {
      const typedOperand = inferExpr(expr.operand, env, markers);
      if (typedOperand === null) return null;
      if (typedOperand.ty.kind !== 'Int' && typedOperand.ty.kind !== 'Float') {
        markers.push({ code: 'T0009', span: expr.span }); return null;
      }
      return { kind: 'unary', op: expr.op, operand: typedOperand, ty: typedOperand.ty, span: expr.span };
    }

    case 'binary': {
      const typedLeft = inferExpr(expr.left, env, markers);
      const typedRight = inferExpr(expr.right, env, markers);
      if (typedLeft === null || typedRight === null) return null;
      const lt = typedLeft.ty;
      const rt = typedRight.ty;

      let ty: Type;
      switch (expr.op) {
        case '+': case '-': case '*': {
          if ((lt.kind !== 'Int' && lt.kind !== 'Float') || (rt.kind !== 'Int' && rt.kind !== 'Float')) {
            markers.push({ code: 'T0009', span: expr.span }); return null;
          }
          ty = (lt.kind === 'Float' || rt.kind === 'Float') ? FLOAT : INT;
          break;
        }
        case '/': {
          if ((lt.kind !== 'Int' && lt.kind !== 'Float') || (rt.kind !== 'Int' && rt.kind !== 'Float')) {
            markers.push({ code: 'T0009', span: expr.span }); return null;
          }
          ty = FLOAT;
          break;
        }
        case 'div': case 'mod': {
          if (lt.kind !== 'Int' || rt.kind !== 'Int') {
            markers.push({ code: 'T0009', span: expr.span }); return null;
          }
          ty = INT;
          break;
        }
        case '==': case '!=': {
          if (leastCommonType(lt, rt) === null) {
            markers.push({ code: 'T0009', span: expr.span }); return null;
          }
          ty = BOOL;
          break;
        }
        case '<': case '<=': case '>': case '>=': {
          if ((lt.kind !== 'Int' && lt.kind !== 'Float') || (rt.kind !== 'Int' && rt.kind !== 'Float')) {
            markers.push({ code: 'T0009', span: expr.span }); return null;
          }
          ty = BOOL;
          break;
        }
      }
      return { kind: 'binary', op: expr.op, left: typedLeft, right: typedRight, ty, span: expr.span };
    }

    case 'list': {
      if (expr.elements.length === 0) {
        if (contextType !== null && contextType.kind === 'List') {
          return { kind: 'list', elements: [], ty: contextType, span: expr.span };
        }
        markers.push({ code: 'T0003', span: expr.span });
        return null;
      }

      const typedElements: TypedExpr[] = [];
      let failed = false;
      for (const el of expr.elements) {
        const te = inferExpr(el, env, markers);
        if (te === null) { failed = true; } else { typedElements.push(te); }
      }
      if (failed) return null;

      let elemType: Type = typedElements[0]!.ty;
      for (const te of typedElements.slice(1)) {
        const ct = leastCommonType(elemType, te.ty);
        if (ct === null) { markers.push({ code: 'T0002', span: expr.span }); return null; }
        elemType = ct;
      }
      // If the surrounding context expects a List with a wider element type
      // (e.g. List<Float> when elements are all Int), widen to match so that
      // the interpreter can coerce elements using expr.ty.elem.
      if (contextType !== null && contextType.kind === 'List') {
        const ct = leastCommonType(elemType, contextType.elem);
        if (ct !== null) elemType = ct;
      }
      return { kind: 'list', elements: typedElements, ty: listOf(elemType), span: expr.span };
    }

    case 'index': {
      const typedList = inferExpr(expr.list, env, markers);
      const typedIndex = inferExpr(expr.index, env, markers);
      if (typedList === null || typedIndex === null) return null;
      if (typedList.ty.kind !== 'List') { markers.push({ code: 'T0010', span: expr.span }); return null; }
      if (typedIndex.ty.kind !== 'Int') { markers.push({ code: 'T0011', span: expr.span }); return null; }
      return { kind: 'index', list: typedList, index: typedIndex, ty: typedList.ty.elem, span: expr.span };
    }

    case 'methodCall': {
      const typedReceiver = inferExpr(expr.receiver, env, markers);
      if (typedReceiver === null) return null;

      const typedArgs: TypedExpr[] = [];
      let failed = false;
      for (const arg of expr.args) {
        const ta = inferExpr(arg, env, markers);
        if (ta === null) { failed = true; } else { typedArgs.push(ta); }
      }
      if (failed) return null;

      const argTypes = typedArgs.map(a => a.ty);
      let resultType: Type | null;
      switch (typedReceiver.ty.kind) {
        case 'Int': resultType = intMethodType(expr.method, argTypes, markers, expr.span); break;
        case 'Float': resultType = floatMethodType(expr.method, argTypes, markers, expr.span); break;
        case 'List': resultType = listMethodType(typedReceiver.ty.elem, expr.method, argTypes, markers, expr.span); break;
        default: markers.push({ code: 'T0012', span: expr.span }); return null;
      }
      if (resultType === null) return null;
      return {
        kind: 'methodCall', receiver: typedReceiver, method: expr.method,
        args: typedArgs, ty: resultType, span: expr.span,
      };
    }

    case 'block':
      return inferBlock(expr, env, markers);

    case 'if':
      return inferIf(expr, env, markers);
  }
};

const inferBlock = (block: Block, env: TypeEnv, markers: Marker[]): TypedBlock | null => {
  const inner = env.child();
  const typedStmts: TypedStatement[] = [];
  let failed = false;
  let blockTy: Type = DONE;

  for (const stmt of block.stmts) {
    const typedStmt = inferStmt(stmt, inner, markers);
    if (typedStmt === null) {
      failed = true;
    } else {
      typedStmts.push(typedStmt);
      blockTy = typedStmt.kind === 'expr' ? typedStmt.expr.ty : DONE;
    }
  }

  if (failed) return null;
  return { kind: 'block', stmts: typedStmts, ty: blockTy, span: block.span };
};

const inferIf = (expr: If, env: TypeEnv, markers: Marker[]): TypedIf | null => {
  const typedCond = inferExpr(expr.cond, env, markers);
  if (typedCond !== null && typedCond.ty.kind !== 'Bool') {
    markers.push({ code: 'T0004', span: expr.cond.span });
  }

  const typedThen = inferBlock(expr.then, env, markers);

  if (expr.else === null) {
    if (typedCond === null || typedThen === null) return null;
    return { kind: 'if', cond: typedCond, then: typedThen, else: null, ty: DONE, span: expr.span };
  }

  const typedElse: TypedBlock | TypedIf | null = expr.else.kind === 'if'
    ? inferIf(expr.else, env, markers)
    : inferBlock(expr.else, env, markers);

  if (typedCond === null || typedThen === null || typedElse === null) return null;

  const ct = leastCommonType(typedThen.ty, typedElse.ty);
  if (ct === null) { markers.push({ code: 'T0005', span: expr.span }); return null; }

  return { kind: 'if', cond: typedCond, then: typedThen, else: typedElse, ty: ct, span: expr.span };
};

const inferStmt = (stmt: Statement, env: TypeEnv, markers: Marker[]): TypedStatement | null => {
  switch (stmt.kind) {
    case 'fix':
    case 'mut': {
      const annotation = stmt.typeAnnotation !== null ? resolveTypeExpr(stmt.typeAnnotation) : null;
      const typedInit = inferExpr(stmt.init, env, markers, annotation);

      let slotType: Type | null;
      if (annotation !== null) {
        if (typedInit !== null && !isAssignableTo(typedInit.ty, annotation)) {
          markers.push({ code: 'T0001', span: stmt.span });
        }
        slotType = annotation;
      } else {
        slotType = typedInit?.ty ?? null;
      }

      if (slotType !== null) env.set(stmt.name, slotType, stmt.kind === 'mut');
      if (typedInit === null) return null;

      return {
        kind: stmt.kind,
        name: stmt.name,
        typeAnnotation: stmt.typeAnnotation,
        slotType: slotType ?? DONE,
        init: typedInit,
        span: stmt.span,
      };
    }

    case 'assign': {
      const binding = env.get(stmt.name);
      if (binding === null) {
        markers.push({ code: 'N0001', span: stmt.span });
      } else if (!binding.mutable) {
        markers.push({ code: 'N0002', span: stmt.span });
      }
      const typedValue = inferExpr(stmt.value, env, markers);
      if (binding !== null && typedValue !== null && !isAssignableTo(typedValue.ty, binding.ty)) {
        markers.push({ code: 'T0001', span: stmt.span });
      }
      if (typedValue === null) return null;
      return {
        kind: 'assign',
        name: stmt.name,
        slotType: binding?.ty ?? DONE,
        value: typedValue,
        span: stmt.span,
      };
    }

    case 'while': {
      const typedCond = inferExpr(stmt.cond, env, markers);
      if (typedCond !== null && typedCond.ty.kind !== 'Bool') {
        markers.push({ code: 'T0004', span: stmt.cond.span });
      }
      const typedBody = inferBlock(stmt.body, env, markers);
      if (typedCond === null || typedBody === null) return null;
      return { kind: 'while', cond: typedCond, body: typedBody, span: stmt.span };
    }

    case 'expr': {
      const typedExpr = inferExpr(stmt.expr, env, markers);
      if (typedExpr === null) return null;
      return { kind: 'expr', expr: typedExpr, span: stmt.span };
    }
  }
};

export const typecheck = (program: Program): TypeCheckResult => {
  const markers: Marker[] = [];
  const env = new TypeEnv();

  for (const arg of program.args) {
    const ty: Type = arg.type === 'Int' ? INT
      : arg.type === 'Float' ? FLOAT
        : arg.type === 'Bool' ? BOOL
          : STRING;
    env.set(arg.name, ty, false);
  }

  const typedStmts: TypedStatement[] = [];
  let failed = false;
  for (const stmt of program.stmts) {
    const typedStmt = inferStmt(stmt, env, markers);
    if (typedStmt === null) { failed = true; } else { typedStmts.push(typedStmt); }
  }

  if (failed || markers.length > 0) {
    return { typedProgram: null, errorMarkers: markers };
  }
  return { typedProgram: { args: program.args, stmts: typedStmts }, errorMarkers: [] };
};
