import type { Expr, Statement, Program, Block, If, TypeExpr, TypeName, ArgType } from './ast.js';
import type { Marker, Span } from '../lexer/token.js';
import type { TypedExpr, TypedBlock, TypedIf, TypedStatement, TypedProgram } from './typed-ast.js';
import {
  AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, NONE_TYPE, DONE_TYPE, listOfType,
  leastCommonType, isAssignableTo,
} from '../types/types.js';

export interface TypeCheckResult {
  typedProgram: TypedProgram | null;
  errorMarkers: Marker[];
}

// A chain of scopes mirroring Environment in the interpreter.
class TypeEnv {
  private vars = new Map<string, { ty: AscentType; mutable: boolean }>();
  public constructor(private readonly parent: TypeEnv | null = null) { }

  public get(name: string): { ty: AscentType; mutable: boolean } | null {
    return this.vars.get(name) ?? this.parent?.get(name) ?? null;
  }

  public set(name: string, ty: AscentType, mutable: boolean): void {
    this.vars.set(name, { ty, mutable });
  }

  public child(): TypeEnv {
    return new TypeEnv(this);
  }
}

// ---- Type formation:  ⊢ T type --------------------------------------
//
// The one place a syntactic type name becomes a semantic AscentType.
// Total over the name union, so an unexpected name is a compile error
// here rather than a silent fall-through elsewhere.

const typeFromName = (name: TypeName['name'] | ArgType): AscentType => {
  switch (name) {
    case 'Int': return INT_TYPE;
    case 'Float': return FLOAT_TYPE;
    case 'Bool': return BOOL_TYPE;
    case 'String': return STRING_TYPE;
  }
};

const typeFromExpr = (te: TypeExpr): AscentType =>
  te.kind === 'TypeName' ? typeFromName(te.name) : listOfType(typeFromExpr(te.elem));

// ---- Method type signatures ------------------------------------------

const requireArity = (expected: number, got: number, markers: Marker[], span: Span): boolean => {
  if (got !== expected) { markers.push({ code: 'T0007', span }); return false; }
  return true;
};

const intMethodType = (method: string, argTypes: AscentType[], markers: Marker[], span: Span): AscentType | null => {
  switch (method) {
    case 'toStr': return requireArity(0, argTypes.length, markers, span) ? STRING_TYPE : null;
    case 'toFloat': return requireArity(0, argTypes.length, markers, span) ? FLOAT_TYPE : null;
    case 'abs': return requireArity(0, argTypes.length, markers, span) ? INT_TYPE : null;
    default: markers.push({ code: 'T0006', span }); return null;
  }
};

const floatMethodType = (method: string, argTypes: AscentType[], markers: Marker[], span: Span): AscentType | null => {
  switch (method) {
    case 'toStr': return requireArity(0, argTypes.length, markers, span) ? STRING_TYPE : null;
    case 'toInt': return requireArity(0, argTypes.length, markers, span) ? INT_TYPE : null;
    case 'abs': return requireArity(0, argTypes.length, markers, span) ? FLOAT_TYPE : null;
    default: markers.push({ code: 'T0006', span }); return null;
  }
};

const listMethodType = (
  elemType: AscentType, method: string, argTypes: AscentType[], markers: Marker[], span: Span,
): AscentType | null => {
  switch (method) {
    case 'length': return requireArity(0, argTypes.length, markers, span) ? INT_TYPE : null;
    case 'isEmpty': return requireArity(0, argTypes.length, markers, span) ? BOOL_TYPE : null;
    case 'reverse': return requireArity(0, argTypes.length, markers, span) ? listOfType(elemType) : null;
    case 'append':
    case 'prepend': {
      if (!requireArity(1, argTypes.length, markers, span)) return null;
      const ct = leastCommonType(elemType, argTypes[0]!);
      if (ct === null) { markers.push({ code: 'T0008', span }); return null; }
      return listOfType(ct);
    }
    case 'concat': {
      if (!requireArity(1, argTypes.length, markers, span)) return null;
      const arg = argTypes[0]!;
      if (arg.kind !== 'List') { markers.push({ code: 'T0008', span }); return null; }
      const ct = leastCommonType(elemType, arg.elem);
      if (ct === null) { markers.push({ code: 'T0008', span }); return null; }
      return listOfType(ct);
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
  expr: Expr, env: TypeEnv, markers: Marker[], contextType: AscentType | null = null,
): TypedExpr | null => {
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

    case 'slot': {
      const binding = env.get(expr.name);
      if (binding === null) { markers.push({ code: 'N0001', span: expr.span }); return null; }
      return { ...expr, type: binding.ty };
    }

    case 'call': {
      // floor is the only built-in for now.
      if (expr.callee !== 'floor') { markers.push({ code: 'T0006', span: expr.span }); return null; }
      if (!requireArity(1, expr.args.length, markers, expr.span)) return null;
      const typedArg = inferExpr(expr.args[0]!, env, markers);
      if (typedArg === null) return null;
      if (typedArg.type.kind !== 'Float') { markers.push({ code: 'T0008', span: expr.span }); return null; }
      return { kind: 'call', callee: expr.callee, args: [typedArg], type: FLOAT_TYPE, span: expr.span };
    }

    case 'unary': {
      const typedOperand = inferExpr(expr.operand, env, markers);
      if (typedOperand === null) return null;
      if (typedOperand.type.kind !== 'Int' && typedOperand.type.kind !== 'Float') {
        markers.push({ code: 'T0009', span: expr.span }); return null;
      }
      return { kind: 'unary', op: expr.op, operand: typedOperand, type: typedOperand.type, span: expr.span };
    }

    case 'binary': {
      const typedLeft = inferExpr(expr.left, env, markers);
      const typedRight = inferExpr(expr.right, env, markers);
      if (typedLeft === null || typedRight === null) return null;
      const lt = typedLeft.type;
      const rt = typedRight.type;

      let type: AscentType;
      switch (expr.op) {
        case '+': case '-': case '*': {
          if ((lt.kind !== 'Int' && lt.kind !== 'Float') || (rt.kind !== 'Int' && rt.kind !== 'Float')) {
            markers.push({ code: 'T0009', span: expr.span }); return null;
          }
          type = (lt.kind === 'Float' || rt.kind === 'Float') ? FLOAT_TYPE : INT_TYPE;
          break;
        }
        case '/': {
          if ((lt.kind !== 'Int' && lt.kind !== 'Float') || (rt.kind !== 'Int' && rt.kind !== 'Float')) {
            markers.push({ code: 'T0009', span: expr.span }); return null;
          }
          type = FLOAT_TYPE;
          break;
        }
        case 'div': case 'mod': {
          if (lt.kind !== 'Int' || rt.kind !== 'Int') {
            markers.push({ code: 'T0009', span: expr.span }); return null;
          }
          type = INT_TYPE;
          break;
        }
        case '==': case '!=': {
          if (leastCommonType(lt, rt) === null) {
            markers.push({ code: 'T0009', span: expr.span }); return null;
          }
          type = BOOL_TYPE;
          break;
        }
        case '<': case '<=': case '>': case '>=': {
          if ((lt.kind !== 'Int' && lt.kind !== 'Float') || (rt.kind !== 'Int' && rt.kind !== 'Float')) {
            markers.push({ code: 'T0009', span: expr.span }); return null;
          }
          type = BOOL_TYPE;
          break;
        }
      }
      return { kind: 'binary', op: expr.op, left: typedLeft, right: typedRight, type, span: expr.span };
    }

    case 'list': {
      if (expr.elements.length === 0) {
        if (contextType !== null && contextType.kind === 'List') {
          return { kind: 'list', elements: [], type: contextType, span: expr.span };
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

      let elemType: AscentType = typedElements[0]!.type;
      for (const te of typedElements.slice(1)) {
        const ct = leastCommonType(elemType, te.type);
        if (ct === null) { markers.push({ code: 'T0002', span: expr.span }); return null; }
        elemType = ct;
      }
      // If the surrounding context expects a List with a wider element type
      // (e.g. List<Float> when elements are all Int), widen to match so that
      // the interpreter can coerce elements using expr.type.elem.
      if (contextType !== null && contextType.kind === 'List') {
        const ct = leastCommonType(elemType, contextType.elem);
        if (ct !== null) elemType = ct;
      }
      return { kind: 'list', elements: typedElements, type: listOfType(elemType), span: expr.span };
    }

    case 'index': {
      const typedList = inferExpr(expr.list, env, markers);
      const typedIndex = inferExpr(expr.index, env, markers);
      if (typedList === null || typedIndex === null) return null;
      if (typedList.type.kind !== 'List') { markers.push({ code: 'T0010', span: expr.span }); return null; }
      if (typedIndex.type.kind !== 'Int') { markers.push({ code: 'T0011', span: expr.span }); return null; }
      return { kind: 'index', list: typedList, index: typedIndex, type: typedList.type.elem, span: expr.span };
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

      const argTypes = typedArgs.map(a => a.type);
      let resultType: AscentType | null;
      switch (typedReceiver.type.kind) {
        case 'Int': resultType = intMethodType(expr.method, argTypes, markers, expr.span); break;
        case 'Float': resultType = floatMethodType(expr.method, argTypes, markers, expr.span); break;
        case 'List': resultType = listMethodType(typedReceiver.type.elem, expr.method, argTypes, markers, expr.span); break;
        default: markers.push({ code: 'T0012', span: expr.span }); return null;
      }
      if (resultType === null) return null;
      return {
        kind: 'methodCall', receiver: typedReceiver, method: expr.method,
        args: typedArgs, type: resultType, span: expr.span,
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
  let blockType: AscentType = DONE_TYPE;

  for (const stmt of block.stmts) {
    const typedStmt = inferStmt(stmt, inner, markers);
    if (typedStmt === null) {
      failed = true;
    } else {
      typedStmts.push(typedStmt);
      blockType = typedStmt.kind === 'expr' ? typedStmt.expr.type : DONE_TYPE;
    }
  }

  if (failed) return null;
  return { kind: 'block', stmts: typedStmts, type: blockType, span: block.span };
};

const inferIf = (expr: If, env: TypeEnv, markers: Marker[]): TypedIf | null => {
  const typedCond = inferExpr(expr.cond, env, markers);
  if (typedCond !== null && typedCond.type.kind !== 'Bool') {
    markers.push({ code: 'T0004', span: expr.cond.span });
  }

  const typedThen = inferBlock(expr.then, env, markers);

  if (expr.else === null) {
    if (typedCond === null || typedThen === null) return null;
    return { kind: 'if', cond: typedCond, then: typedThen, else: null, type: DONE_TYPE, span: expr.span };
  }

  const typedElse: TypedBlock | TypedIf | null = expr.else.kind === 'if'
    ? inferIf(expr.else, env, markers)
    : inferBlock(expr.else, env, markers);

  if (typedCond === null || typedThen === null || typedElse === null) return null;

  const ct = leastCommonType(typedThen.type, typedElse.type);
  if (ct === null) { markers.push({ code: 'T0005', span: expr.span }); return null; }

  return { kind: 'if', cond: typedCond, then: typedThen, else: typedElse, type: ct, span: expr.span };
};

const inferStmt = (stmt: Statement, env: TypeEnv, markers: Marker[]): TypedStatement | null => {
  switch (stmt.kind) {
    case 'fix':
    case 'mut': {
      const annotation = stmt.typeAnnotation !== null ? typeFromExpr(stmt.typeAnnotation) : null;
      const typedInit = inferExpr(stmt.init, env, markers, annotation);

      let slotType: AscentType | null;
      if (annotation !== null) {
        if (typedInit !== null && !isAssignableTo(typedInit.type, annotation)) {
          markers.push({ code: 'T0001', span: stmt.span });
        }
        slotType = annotation;
      } else {
        slotType = typedInit?.type ?? null;
      }

      if (slotType !== null) env.set(stmt.name, slotType, stmt.kind === 'mut');
      if (typedInit === null) return null;

      return {
        kind: stmt.kind,
        name: stmt.name,
        typeAnnotation: stmt.typeAnnotation,
        slotType: slotType ?? DONE_TYPE,
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
      if (binding !== null && typedValue !== null && !isAssignableTo(typedValue.type, binding.ty)) {
        markers.push({ code: 'T0001', span: stmt.span });
      }
      if (typedValue === null) return null;
      return {
        kind: 'assign',
        name: stmt.name,
        slotType: binding?.ty ?? DONE_TYPE,
        value: typedValue,
        span: stmt.span,
      };
    }

    case 'while': {
      const typedCond = inferExpr(stmt.cond, env, markers);
      if (typedCond !== null && typedCond.type.kind !== 'Bool') {
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
    env.set(arg.name, typeFromName(arg.type), false);
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
