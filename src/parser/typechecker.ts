import type { Expr, Statement, Program, Block, If, TypeExpr, TypeName, ArgType } from './ast.js';
import type { Marker, Span } from '../lexer/token.js';
import type { TypedExpr, TypedBlock, TypedIf, TypedStatement, TypedProgram, TypedTemplatePart } from './typed-ast.js';
import {
  AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, NONE_TYPE, DONE_TYPE, NEVER_TYPE, INVALID_TYPE,
  listOfType, optionalOf, leastCommonType, isAssignableTo, typeToString, typesEqual, isScalarType,
} from '../types/types.js';
import { Diagnostic, elaborate } from '../errors/elaborate.js';

export interface TypedResult {
  program: TypedProgram | null;
  diagnostics: Diagnostic[];
}

// ---- Diagnostics sink -------------------------------------------------
//
// Replaces the Marker[] that used to thread through every judgment
// (agenda/typechecker-refactor.md Phase 5a). Productions call error() as
// they go; typecheck() elaborates the whole batch against the source once,
// at the very end, instead of each call site carrying an array reference.
export class Diagnostics {
  private readonly markers: Marker[] = [];

  public error(marker: Marker): void {
    this.markers.push(marker);
  }

  public get hasErrors(): boolean {
    return this.markers.length > 0;
  }

  public elaborate(source: string): Diagnostic[] {
    return this.markers.map(m => elaborate(m, source));
  }
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

const typeFromExpr = (te: TypeExpr): AscentType => {
  switch (te.kind) {
    case 'TypeName': return typeFromName(te.name);
    case 'ListType': return listOfType(typeFromExpr(te.elem));
    case 'OptionalType': return optionalOf(typeFromExpr(te.elem));
  }
};

// ---- Method type signatures ------------------------------------------

const requireArity = (expected: number, got: number, diagnostics: Diagnostics, span: Span): boolean => {
  if (got !== expected) {
    diagnostics.error({ code: 'T0007', span, data: { expected: String(expected), got: String(got) } });
    return false;
  }
  return true;
};

// A value-type mismatch that carries the expected and actual type names.
// Reports the diagnostic and hands back Invalid — the checker-internal
// tombstone (agenda/phase5.md) for a node whose own check just failed — so
// callers can fold it straight into the node they're building instead of
// branching on a separate null case.
const typeMismatch = (
  code: string, diagnostics: Diagnostics, span: Span, expected: AscentType, actual: AscentType,
  related: { key: string; span: Span }[] = [],
): AscentType => {
  diagnostics.error({
    code, span, related,
    data: { expected: typeToString(expected), actual: typeToString(actual) },
  });
  return INVALID_TYPE;
};

// An operator applied to operands it doesn't accept (T0009). `operands` is the
// joined list of type names — one for a unary '-', two for a binary operator.
const operandError = (diagnostics: Diagnostics, op: string, span: Span, ...operands: AscentType[]): AscentType => {
  diagnostics.error({ code: 'T0009', span, data: { op, operands: operands.map(typeToString).join(' and ') } });
  return INVALID_TYPE;
};

// ---- Built-in signatures: data, not control flow ----------------------
//
// "What methods/functions exist" is data that grows whenever a builtin is
// added; "how a call is checked against that data" is the one rule below
// (methodCallType). Most signatures are monomorphic — fixed arity, fixed
// result; the List methods whose result depends on the receiver's element
// type keep a small resolver instead.
//
// None of this table or its dispatch needs to know about Invalid: synth's
// 'call'/'methodCall' cases (below) bail out to Invalid *before* ever
// reaching this code whenever a receiver or argument already failed, so
// nothing here ever actually sees one.

interface MonoSig {
  params: readonly AscentType[];
  result: AscentType;
}

interface ResolvedSig {
  arity: number;
  resolve: (recv: AscentType, args: AscentType[], diagnostics: Diagnostics, span: Span) => AscentType;
}

type MethodSig = MonoSig | ResolvedSig;
type TypeKind = AscentType['kind'];

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

const METHODS: Partial<Record<TypeKind, Record<string, MethodSig>>> = {
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
const FUNCTIONS: Record<string, MonoSig> = {
  floor: { params: [FLOAT_TYPE], result: FLOAT_TYPE },
};

// The one place a method call's result type is looked up: T0012 when the
// receiver's type has no methods at all, T0006 when it has methods but not
// this one, otherwise dispatch to the signature.
const methodCallType = (
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

// ---- Expression synthesis:  Γ ⊢ e ⇒ T --------------------------------
//
// No expectation flows in; produce a type from the expression alone.
// Always returns a TypedExpr with a type embedded — a sub-expression that
// fails to check gets Invalid (agenda/phase5.md) instead of null, so a
// caller never needs to abort just to keep checking the rest of the tree;
// it only needs to skip the checks that Invalid itself would poison (see
// each case's own "already Invalid" guard below).

const isInvalid = (t: AscentType): boolean => t.kind === 'Invalid';

// The join of a non-empty list literal's typed elements, pairwise against
// the first — T0002 when two elements share no common supertype. Shared by
// synth (the result is the list's type, as-is) and check (which may still
// widen the result further toward an expected element type). leastCommonType
// is already Invalid-aware, so an element that failed on its own quietly
// carries Invalid through the join without a second diagnostic here.
const joinElementTypes = (typedElements: TypedExpr[], span: Span, diagnostics: Diagnostics): AscentType => {
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

const synth = (expr: Expr, env: TypeEnv, diagnostics: Diagnostics): TypedExpr => {
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
        if (!isInvalid(typedHole.type) && !isScalarType(typedHole.type)) {
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
      if (typedArgs.some(a => isInvalid(a.type))) {
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
      if (isInvalid(typedOperand.type)) {
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
      if (isInvalid(lt) || isInvalid(rt)) {
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

    case 'index': {
      const typedList = synth(expr.list, env, diagnostics);
      const typedIndex = synth(expr.index, env, diagnostics);
      if (isInvalid(typedList.type) || isInvalid(typedIndex.type)) {
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
      if (isInvalid(typedReceiver.type) || typedArgs.some(a => isInvalid(a.type))) {
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

    case 'block':
      return inferBlock(expr, env, diagnostics);

    case 'if':
      return inferIf(expr, env, diagnostics);
  }
};

// ---- Expression checking:  Γ ⊢ e ⇐ T ---------------------------------
//
// An expected type flows in from the use site — today that's only a
// fix/mut annotation, via `related`, the span(s) to attach to a mismatch
// (e.g. "annotation" pointing back at the written type). `expected` always
// comes from a written TypeExpr (never Invalid — Invalid can't be named in
// source, agenda/phase5.md Rule 3), so only the synthesized side ever needs
// Invalid-awareness. The default rule covers almost every form: synthesize,
// then require the result <: expected, recording T0001 when it isn't —
// subtype()'s own Invalid-absorption already keeps that check quiet when
// synth produced Invalid, with no special-casing needed here. Two forms of a
// list literal override the default because the expectation reshapes the
// synthesized node instead of merely being compared against it (design.md
// §7):
//   • empty list []  — adopts `expected` as its own type outright
//   • non-empty list — its elements' joined type widens toward
//     `expected`'s element type (e.g. Int elements under a List<Float>
//     expectation), so the interpreter can coerce from the node's own
//     `.type.elem` later
const check = (
  expr: Expr, expected: AscentType, env: TypeEnv, diagnostics: Diagnostics,
  related: { key: string; span: Span }[] = [],
): TypedExpr => {
  if (expr.kind === 'list' && expr.elements.length === 0 && expected.kind === 'List') {
    return { kind: 'list', elements: [], type: expected, span: expr.span };
  }

  if (expr.kind === 'list' && expr.elements.length > 0) {
    const typedElements = expr.elements.map(el => synth(el, env, diagnostics));
    let elemType = joinElementTypes(typedElements, expr.span, diagnostics);
    if (expected.kind === 'List') {
      const ct = leastCommonType(elemType, expected.elem);
      if (ct !== null) elemType = ct;
    }
    const node: TypedExpr = { kind: 'list', elements: typedElements, type: listOfType(elemType), span: expr.span };
    if (!isAssignableTo(node.type, expected)) {
      typeMismatch('T0001', diagnostics, node.span, expected, node.type, related);
    }
    return node;
  }

  const node = synth(expr, env, diagnostics);
  if (!isAssignableTo(node.type, expected)) {
    typeMismatch('T0001', diagnostics, node.span, expected, node.type, related);
  }
  return node;
};

const inferBlock = (block: Block, env: TypeEnv, diagnostics: Diagnostics): TypedBlock => {
  const inner = env.child();
  const typedStmts: TypedStatement[] = [];
  let blockType: AscentType = DONE_TYPE;

  for (const stmt of block.stmts) {
    const typedStmt = inferStmt(stmt, inner, diagnostics);
    typedStmts.push(typedStmt);
    blockType = typedStmt.kind === 'expr' ? typedStmt.expr.type : DONE_TYPE;
  }

  return { kind: 'block', stmts: typedStmts, type: blockType, span: block.span };
};

const inferIf = (expr: If, env: TypeEnv, diagnostics: Diagnostics): TypedIf => {
  const typedCond = synth(expr.cond, env, diagnostics);
  // An Invalid condition already carries its own reported failure — it
  // doesn't decide *what type* the 'if' produces (that's the branches'
  // job), so only the Bool check gets suppressed here, not the branch join
  // below (T0004 and T0005 inspect different things and stay independent).
  if (!isInvalid(typedCond.type) && typedCond.type.kind !== 'Bool') {
    diagnostics.error({ code: 'T0004', span: expr.cond.span, data: { actual: typeToString(typedCond.type) } });
  }

  const typedThen = inferBlock(expr.then, env, diagnostics);

  if (expr.else === null) {
    return { kind: 'if', cond: typedCond, then: typedThen, else: null, type: DONE_TYPE, span: expr.span };
  }

  const typedElse: TypedBlock | TypedIf = expr.else.kind === 'if'
    ? inferIf(expr.else, env, diagnostics)
    : inferBlock(expr.else, env, diagnostics);

  const ct = leastCommonType(typedThen.type, typedElse.type);
  if (ct === null) {
    diagnostics.error({
      code: 'T0005', span: expr.span,
      data: { then: typeToString(typedThen.type), else: typeToString(typedElse.type) },
      related: [
        { key: 'then', span: typedThen.span },
        { key: 'else', span: typedElse.span },
      ],
    });
  }

  return { kind: 'if', cond: typedCond, then: typedThen, else: typedElse, type: ct ?? INVALID_TYPE, span: expr.span };
};

// True when 'Never' appears anywhere in t's structure — the un-annotated
// fix/mut check below uses this to catch not just a bare '[]' but anything
// built from one with no widening context ('[].reverse()', '[[]]', …), since
// all of those freeze the same way once the slot's type is fixed.
const containsNever = (t: AscentType): boolean => {
  if (t.kind === 'Never') return true;
  if (t.kind === 'List' || t.kind === 'Optional') return containsNever(t.elem);
  return false;
};

const inferStmt = (stmt: Statement, env: TypeEnv, diagnostics: Diagnostics): TypedStatement => {
  switch (stmt.kind) {
    case 'fix':
    case 'mut': {
      const annotation = stmt.typeAnnotation !== null ? typeFromExpr(stmt.typeAnnotation) : null;

      let typedInit: TypedExpr;
      let slotType: AscentType;
      if (annotation !== null) {
        // The written annotation always wins as the slot's type, even when
        // the init expression itself failed to check (agenda/phase5.md's
        // "quality lever": prefer a real, declared type over Invalid so the
        // failure stops here instead of freezing every later use of the
        // slot at Invalid too).
        typedInit = check(stmt.init, annotation, env, diagnostics, [{ key: 'annotation', span: stmt.typeAnnotation!.span }]);
        slotType = annotation;
      } else {
        typedInit = synth(stmt.init, env, diagnostics);
        if (isInvalid(typedInit.type)) {
          // Its own failure was already reported where it was synthesized —
          // don't also demand an annotation for a type that was never real.
        } else if (typedInit.type.kind === 'None') {
          // design.md §7's slot-inference wrinkle: a bare 'None' carries no
          // type information (there's nothing to widen it to) — so it needs
          // a written annotation too.
          diagnostics.error({ code: 'T0015', span: stmt.init.span });
        } else if (containsNever(typedInit.type)) {
          // Same wrinkle for a bare '[]' (or anything built from one, like
          // '[].reverse()'): List<Never> would otherwise freeze the slot at
          // a type nothing can ever be assigned back into (T0003 —
          // 'append' works fine as a standalone expression, since there
          // Never widens freely; only a *fixed slot type* can't take that
          // widened value back once reassigned).
          diagnostics.error({ code: 'T0003', span: stmt.init.span });
        }
        slotType = typedInit.type;
      }

      env.set(stmt.name, slotType, stmt.kind, stmt.span);

      return {
        kind: stmt.kind,
        name: stmt.name,
        typeAnnotation: stmt.typeAnnotation,
        slotType,
        init: typedInit,
        span: stmt.span,
      };
    }

    case 'assign': {
      const binding = env.get(stmt.name);
      if (binding === null) {
        // Assigning to a name that was never created — a different mistake
        // (and lesson) than using an undefined name in an expression (N0001).
        diagnostics.error({ code: 'N0003', span: stmt.nameSpan });
      } else if (binding.origin === 'arg') {
        // A program input is read-only for the whole run — its own lesson,
        // distinct from a 'fix' slot (there is no 'mut' arg to switch to).
        diagnostics.error({ code: 'N0004', span: stmt.nameSpan });
      } else if (binding.origin === 'fix') {
        // Point back at the 'fix' declaration ("created with 'fix' here"),
        // which always has a source location.
        const related = binding.declSpan !== null
          ? [{ key: 'declaration', span: binding.declSpan }]
          : [];
        diagnostics.error({ code: 'N0002', span: stmt.nameSpan, related });
      }
      const typedValue = synth(stmt.value, env, diagnostics);
      if (binding !== null && !isAssignableTo(typedValue.type, binding.ty)) {
        const related = binding.declSpan !== null ? [{ key: 'declaration', span: binding.declSpan }] : [];
        diagnostics.error({
          code: 'T0001', span: stmt.value.span,
          data: { expected: typeToString(binding.ty), actual: typeToString(typedValue.type) },
          related,
        });
      }
      return {
        kind: 'assign',
        name: stmt.name,
        slotType: binding?.ty ?? DONE_TYPE,
        value: typedValue,
        span: stmt.span,
      };
    }

    case 'while': {
      const typedCond = synth(stmt.cond, env, diagnostics);
      if (!isInvalid(typedCond.type) && typedCond.type.kind !== 'Bool') {
        diagnostics.error({ code: 'T0004', span: stmt.cond.span, data: { actual: typeToString(typedCond.type) } });
      }
      const typedBody = inferBlock(stmt.body, env, diagnostics);
      return { kind: 'while', cond: typedCond, body: typedBody, span: stmt.span };
    }

    case 'expr': {
      return { kind: 'expr', expr: synth(stmt.expr, env, diagnostics), span: stmt.span };
    }
  }
};

// parentEnv lets a caller (the REPL) carry name bindings across separate
// typecheck() calls: each call type-checks into a child scope, and only
// promotes its new bindings into parentEnv once the whole program's
// diagnostics come back empty, so a line that fails typechecking never
// leaks a partial declaration into later lines.
//
// Since Phase 5, this always returns a fully-typed tree — even a program
// with type errors gets one, built from Invalid wherever a node failed to
// check (agenda/phase5.md) — instead of throwing it away on the first
// error, which is what editor tooling wants. That tree is a *tooling*
// artifact only: callers must still gate execution on `diagnostics.length
// === 0` (as every caller in this codebase already does), never on
// `program` being non-null, since a broken program's tree still contains
// Invalid nodes that must never reach the interpreter.
export const typecheck = (program: Program, source: string, parentEnv?: TypeEnv): TypedResult => {
  const diagnostics = new Diagnostics();
  const env = parentEnv !== undefined ? parentEnv.child() : new TypeEnv();

  for (const arg of program.args) {
    env.set(arg.name, typeFromName(arg.type), 'arg');
  }

  const typedStmts: TypedStatement[] = program.stmts.map(stmt => inferStmt(stmt, env, diagnostics));

  if (diagnostics.hasErrors) {
    return { program: { args: program.args, stmts: typedStmts }, diagnostics: diagnostics.elaborate(source) };
  }

  if (parentEnv !== undefined) {
    for (const [name, binding] of env.ownEntries()) {
      parentEnv.set(name, binding.ty, binding.origin, binding.declSpan);
    }
  }

  return { program: { args: program.args, stmts: typedStmts }, diagnostics: [] };
};
