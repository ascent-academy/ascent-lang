import type { Expr, Statement, Program, Block, If, TypeExpr, TypeName, ArgType } from './ast.js';
import type { Marker, Span } from '../lexer/token.js';
import type { TypedExpr, TypedBlock, TypedIf, TypedStatement, TypedProgram, TypedTemplatePart } from './typed-ast.js';
import {
  AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, NONE_TYPE, DONE_TYPE, listOfType,
  leastCommonType, isAssignableTo, typeToString, typesEqual, isScalarType,
} from '../types/types.js';

export interface TypedResult {
  program: TypedProgram | null;
  errorMarkers: Marker[];
}

// origin records how the name was created — 'fix'/'mut' declarations, or a
// program 'arg' input — so the three reassignment mistakes get distinct errors.
// declSpan is where a fix/mut name was created (so errors can point back at it);
// it is null for names with no source location (program args).
interface Binding {
  ty: AscentType;
  origin: 'fix' | 'mut' | 'arg';
  declSpan: Span | null;
}

// A chain of scopes mirroring Environment in the interpreter.
export class TypeEnv {
  private vars = new Map<string, Binding>();
  public constructor(private readonly parent: TypeEnv | null = null) { }

  public get(name: string): Binding | null {
    return this.vars.get(name) ?? this.parent?.get(name) ?? null;
  }

  public set(name: string, ty: AscentType, origin: Binding['origin'], declSpan: Span | null = null): void {
    this.vars.set(name, { ty, origin, declSpan });
  }

  public child(): TypeEnv {
    return new TypeEnv(this);
  }

  // The bindings declared directly in this scope (not inherited from a
  // parent) — used to promote a successful trial scope's new names into
  // a persistent parent, e.g. across REPL lines.
  public ownEntries(): IterableIterator<[string, Binding]> {
    return this.vars.entries();
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
  if (got !== expected) {
    markers.push({ code: 'T0007', span, data: { expected: String(expected), got: String(got) } });
    return false;
  }
  return true;
};

// A value-type mismatch that carries the expected and actual type names.
const typeMismatch = (
  code: string, markers: Marker[], span: Span, expected: AscentType, actual: AscentType,
  related: { key: string; span: Span }[] = [],
): null => {
  markers.push({
    code, span, related,
    data: { expected: typeToString(expected), actual: typeToString(actual) },
  });
  return null;
};

// An operator applied to operands it doesn't accept (T0009). `operands` is the
// joined list of type names — one for a unary '-', two for a binary operator.
const operandError = (markers: Marker[], op: string, span: Span, ...operands: AscentType[]): null => {
  markers.push({ code: 'T0009', span, data: { op, operands: operands.map(typeToString).join(' and ') } });
  return null;
};

// ---- Built-in signatures: data, not control flow ----------------------
//
// "What methods/functions exist" is data that grows whenever a builtin is
// added; "how a call is checked against that data" is the one rule below
// (methodCallType). Most signatures are monomorphic — fixed arity, fixed
// result; the List methods whose result depends on the receiver's element
// type keep a small resolver instead.

interface MonoSig {
  params: readonly AscentType[];
  result: AscentType;
}

interface ResolvedSig {
  arity: number;
  resolve: (recv: AscentType, args: AscentType[], markers: Marker[], span: Span) => AscentType | null;
}

type MethodSig = MonoSig | ResolvedSig;
type TypeKind = AscentType['kind'];

// Arity, then each param checked against its argument in order — pushes
// T0007 / T0008 and stops at the first mismatch, same as the old
// hand-rolled dispatchers.
const checkParams = (
  params: readonly AscentType[], args: AscentType[], markers: Marker[], span: Span,
): boolean => {
  if (!requireArity(params.length, args.length, markers, span)) return false;
  for (let i = 0; i < params.length; i++) {
    if (!typesEqual(args[i]!, params[i]!)) {
      typeMismatch('T0008', markers, span, params[i]!, args[i]!);
      return false;
    }
  }
  return true;
};

const applySig = (
  sig: MethodSig, recv: AscentType, args: AscentType[], markers: Marker[], span: Span,
): AscentType | null => {
  if ('result' in sig) return checkParams(sig.params, args, markers, span) ? sig.result : null;
  if (!requireArity(sig.arity, args.length, markers, span)) return null;
  return sig.resolve(recv, args, markers, span);
};

// append and prepend put the value on different ends at runtime, but share
// one type rule: widen to the join of the element and argument types (e.g.
// appending a Float to a List<Int> gives List<Float>).
const appendLike = (recv: AscentType, args: AscentType[], markers: Marker[], span: Span): AscentType | null => {
  if (recv.kind !== 'List') return null;
  const ct = leastCommonType(recv.elem, args[0]!);
  return ct === null ? typeMismatch('T0008', markers, span, recv.elem, args[0]!) : listOfType(ct);
};

const METHODS: Partial<Record<TypeKind, Record<string, MethodSig>>> = {
  Int: {
    toStr: { params: [], result: STRING_TYPE },
    toFloat: { params: [], result: FLOAT_TYPE },
    abs: { params: [], result: INT_TYPE },
  },
  Float: {
    toStr: { params: [], result: STRING_TYPE },
    toInt: { params: [], result: INT_TYPE },
    abs: { params: [], result: FLOAT_TYPE },
  },
  List: {
    length: { params: [], result: INT_TYPE },
    isEmpty: { params: [], result: BOOL_TYPE },
    reverse: { arity: 0, resolve: recv => recv.kind === 'List' ? listOfType(recv.elem) : null },
    append: { arity: 1, resolve: appendLike },
    prepend: { arity: 1, resolve: appendLike },
    concat: {
      arity: 1,
      resolve: (recv, args, markers, span) => {
        if (recv.kind !== 'List') return null;
        const arg = args[0]!;
        if (arg.kind !== 'List') return typeMismatch('T0008', markers, span, listOfType(recv.elem), arg);
        const ct = leastCommonType(recv.elem, arg.elem);
        return ct === null ? typeMismatch('T0008', markers, span, listOfType(recv.elem), arg) : listOfType(ct);
      },
    },
  },
};

// Ascent's one built-in function, folded in as an ordinary signature
// instead of a special case in inferExpr's 'call' branch.
const FUNCTIONS: Record<string, MonoSig> = {
  floor: { params: [FLOAT_TYPE], result: FLOAT_TYPE },
};

// The one place a method call's result type is looked up: T0012 when the
// receiver's type has no methods at all, T0006 when it has methods but not
// this one, otherwise dispatch to the signature.
const methodCallType = (
  recv: AscentType, method: string, args: AscentType[], markers: Marker[], span: Span,
): AscentType | null => {
  const table = METHODS[recv.kind];
  if (table === undefined) {
    markers.push({ code: 'T0012', span, data: { type: typeToString(recv) } });
    return null;
  }
  const sig = table[method];
  if (sig === undefined) {
    markers.push({ code: 'T0006', span, data: { method, type: typeToString(recv) } });
    return null;
  }
  return applySig(sig, recv, args, markers, span);
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

    // A '${ }' hole splices its value straight into the surrounding text. Any
    // scalar (Int/Float/Bool/String, design.md §4) is accepted as-is — a
    // hardcoded rule standing in for a Show-style trait until traits exist
    // (§7); anything else (None, Done, List) has no obvious text form and
    // must be converted explicitly first. A String with no holes never
    // reaches here — it stays the plain 'literal' case above.
    case 'template': {
      const typedParts: TypedTemplatePart[] = [];
      let failed = false;
      for (const part of expr.parts) {
        if (part.kind === 'text') {
          typedParts.push(part);
          continue;
        }
        const typedHole = inferExpr(part.expr, env, markers);
        if (typedHole === null) { failed = true; continue; }
        if (!isScalarType(typedHole.type)) {
          markers.push({ code: 'T0014', span: part.expr.span, data: { actual: typeToString(typedHole.type) } });
          failed = true;
          continue;
        }
        typedParts.push({ kind: 'hole', expr: typedHole });
      }
      if (failed) return null;
      return { kind: 'template', parts: typedParts, type: STRING_TYPE, span: expr.span };
    }

    case 'slot': {
      const binding = env.get(expr.name);
      if (binding === null) { markers.push({ code: 'N0001', span: expr.span }); return null; }
      return { ...expr, type: binding.ty };
    }

    case 'call': {
      const sig = FUNCTIONS[expr.callee];
      if (sig === undefined) { markers.push({ code: 'T0013', span: expr.span, data: { name: expr.callee } }); return null; }
      if (!requireArity(sig.params.length, expr.args.length, markers, expr.span)) return null;

      const typedArgs: TypedExpr[] = [];
      let failed = false;
      for (const arg of expr.args) {
        const ta = inferExpr(arg, env, markers);
        if (ta === null) { failed = true; } else { typedArgs.push(ta); }
      }
      if (failed) return null;

      for (let i = 0; i < sig.params.length; i++) {
        if (!typesEqual(typedArgs[i]!.type, sig.params[i]!)) {
          return typeMismatch('T0008', markers, expr.span, sig.params[i]!, typedArgs[i]!.type);
        }
      }
      return { kind: 'call', callee: expr.callee, args: typedArgs, type: sig.result, span: expr.span };
    }

    case 'unary': {
      const typedOperand = inferExpr(expr.operand, env, markers);
      if (typedOperand === null) return null;
      if (expr.op === 'not') {
        if (typedOperand.type.kind !== 'Bool') {
          return operandError(markers, expr.op, expr.span, typedOperand.type);
        }
        return { kind: 'unary', op: expr.op, operand: typedOperand, type: BOOL_TYPE, span: expr.span };
      }
      if (typedOperand.type.kind !== 'Int' && typedOperand.type.kind !== 'Float') {
        return operandError(markers, expr.op, expr.span, typedOperand.type);
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
        case '+': case '-': case '*': case '**': {
          if ((lt.kind !== 'Int' && lt.kind !== 'Float') || (rt.kind !== 'Int' && rt.kind !== 'Float')) {
            return operandError(markers, expr.op, expr.span, lt, rt);
          }
          type = (lt.kind === 'Float' || rt.kind === 'Float') ? FLOAT_TYPE : INT_TYPE;
          break;
        }
        case '/': {
          if ((lt.kind !== 'Int' && lt.kind !== 'Float') || (rt.kind !== 'Int' && rt.kind !== 'Float')) {
            return operandError(markers, expr.op, expr.span, lt, rt);
          }
          type = FLOAT_TYPE;
          break;
        }
        case 'div': case 'mod': {
          if (lt.kind !== 'Int' || rt.kind !== 'Int') {
            return operandError(markers, expr.op, expr.span, lt, rt);
          }
          type = INT_TYPE;
          break;
        }
        case '==': case '!=': {
          if (leastCommonType(lt, rt) === null) {
            return operandError(markers, expr.op, expr.span, lt, rt);
          }
          type = BOOL_TYPE;
          break;
        }
        case '<': case '<=': case '>': case '>=': {
          if ((lt.kind !== 'Int' && lt.kind !== 'Float') || (rt.kind !== 'Int' && rt.kind !== 'Float')) {
            return operandError(markers, expr.op, expr.span, lt, rt);
          }
          type = BOOL_TYPE;
          break;
        }
        case 'and':
        case 'or': {
          if (lt.kind !== 'Bool' || rt.kind !== 'Bool') {
            return operandError(markers, expr.op, expr.span, lt, rt);
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
        if (ct === null) {
          markers.push({
            code: 'T0002', span: expr.span,
            data: { first: typeToString(elemType), other: typeToString(te.type) },
            related: [{ key: 'element', span: te.span }],
          });
          return null;
        }
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
      if (typedList.type.kind !== 'List') {
        markers.push({ code: 'T0010', span: expr.list.span, data: { actual: typeToString(typedList.type) } });
        return null;
      }
      if (typedIndex.type.kind !== 'Int') {
        markers.push({ code: 'T0011', span: expr.index.span, data: { actual: typeToString(typedIndex.type) } });
        return null;
      }
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
      const resultType = methodCallType(typedReceiver.type, expr.method, argTypes, markers, expr.span);
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
    markers.push({ code: 'T0004', span: expr.cond.span, data: { actual: typeToString(typedCond.type) } });
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
  if (ct === null) {
    markers.push({
      code: 'T0005', span: expr.span,
      data: { then: typeToString(typedThen.type), else: typeToString(typedElse.type) },
      related: [
        { key: 'then', span: typedThen.span },
        { key: 'else', span: typedElse.span },
      ],
    });
    return null;
  }

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
          markers.push({
            code: 'T0001', span: stmt.init.span,
            data: { expected: typeToString(annotation), actual: typeToString(typedInit.type) },
            related: [{ key: 'annotation', span: stmt.typeAnnotation!.span }],
          });
        }
        slotType = annotation;
      } else {
        slotType = typedInit?.type ?? null;
      }

      if (slotType !== null) env.set(stmt.name, slotType, stmt.kind, stmt.span);
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
        // Assigning to a name that was never created — a different mistake
        // (and lesson) than using an undefined name in an expression (N0001).
        markers.push({ code: 'N0003', span: stmt.nameSpan });
      } else if (binding.origin === 'arg') {
        // A program input is read-only for the whole run — its own lesson,
        // distinct from a 'fix' slot (there is no 'mut' arg to switch to).
        markers.push({ code: 'N0004', span: stmt.nameSpan });
      } else if (binding.origin === 'fix') {
        // Point back at the 'fix' declaration ("created with 'fix' here"),
        // which always has a source location.
        const related = binding.declSpan !== null
          ? [{ key: 'declaration', span: binding.declSpan }]
          : [];
        markers.push({ code: 'N0002', span: stmt.nameSpan, related });
      }
      const typedValue = inferExpr(stmt.value, env, markers);
      if (binding !== null && typedValue !== null && !isAssignableTo(typedValue.type, binding.ty)) {
        const related = binding.declSpan !== null ? [{ key: 'declaration', span: binding.declSpan }] : [];
        markers.push({
          code: 'T0001', span: stmt.value.span,
          data: { expected: typeToString(binding.ty), actual: typeToString(typedValue.type) },
          related,
        });
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
        markers.push({ code: 'T0004', span: stmt.cond.span, data: { actual: typeToString(typedCond.type) } });
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

// parentEnv lets a caller (the REPL) carry name bindings across separate
// typecheck() calls: each call type-checks into a child scope, and only
// promotes its new bindings into parentEnv once the whole program
// succeeds, so a line that fails typechecking never leaks a partial
// declaration into later lines.
export const typecheck = (program: Program, parentEnv?: TypeEnv): TypedResult => {
  const markers: Marker[] = [];
  const env = parentEnv !== undefined ? parentEnv.child() : new TypeEnv();

  for (const arg of program.args) {
    env.set(arg.name, typeFromName(arg.type), 'arg');
  }

  const typedStmts: TypedStatement[] = [];
  let failed = false;
  for (const stmt of program.stmts) {
    const typedStmt = inferStmt(stmt, env, markers);
    if (typedStmt === null) { failed = true; } else { typedStmts.push(typedStmt); }
  }

  if (failed || markers.length > 0) {
    return { program: null, errorMarkers: markers };
  }

  if (parentEnv !== undefined) {
    for (const [name, binding] of env.ownEntries()) {
      parentEnv.set(name, binding.ty, binding.origin, binding.declSpan);
    }
  }

  return { program: { args: program.args, stmts: typedStmts }, errorMarkers: [] };
};
