import type { ProgramArg } from './parser/ast.js';
import type { TypedExpr, TypedBlock, TypedStatement, TypedProgram } from './parser/typed-ast.js';
import type { Span } from './lexer/token.js';
import type { AscentType } from './types/types.js';
import { RuntimeError } from './errors/runtime-error.js';
import {
  coerce, formatFloat, scalarToString, graphemesOf,
  intVal, floatVal, strVal, boolVal, NONE, DONE,
  type ScalarValue, type RuntimeValue,
} from './interpreter/values.js';
import { checkIntOverflow, checkFiniteFloat, evaluateBinary } from './interpreter/arithmetic.js';
import { Environment, type AssignResult } from './interpreter/env.js';

// Re-export the value domain and the scope chain so existing importers of
// './interpreter.js' (lib.ts, the CLI, the tests) keep resolving
// RuntimeValue/ScalarValue/Environment/AssignResult here; interpreter/values.ts
// and interpreter/env.ts are the sources of truth.
export type { ScalarValue, RuntimeValue };
export { Environment };
export type { AssignResult };

export const evaluateExpr = (expr: TypedExpr, env: Environment): RuntimeValue => {
  switch (expr.kind) {
    case 'literal': {
      switch (expr.valueType) {
        case 'Int': return intVal(checkIntOverflow(expr.value, expr.span));
        case 'Float': return floatVal(checkFiniteFloat(expr.value, expr.span));
        case 'Bool': return boolVal(expr.value);
        case 'String': return strVal(expr.value);
        case 'None': return NONE;
        case 'Done': return DONE;
      }
    }
    case 'template': {
      let result = '';
      for (const part of expr.parts) {
        if (part.kind === 'text') { result += part.value; continue; }
        result += scalarToString(evaluateExpr(part.expr, env));
      }
      return strVal(result);
    }
    case 'slot': {
      // Name-binding errors (N0001–N0003) are caught at type-check time; this
      // is an internal guard.
      const value = env.get(expr.name);
      if (value === undefined) throw new Error(`internal: unbound slot '${expr.name}'`);
      return value;
    }
    case 'call': {
      // floor is the only built-in; others are rejected by the type checker.
      const args = expr.args.map(a => evaluateExpr(a, env));
      if (expr.callee === 'floor') {
        const arg = args[0]!;
        if (arg.type !== 'Float') throw new Error('internal: floor arg not Float');
        return floatVal(Math.floor(arg.value));
      }
      throw new Error(`internal: unknown built-in '${expr.callee}'`);
    }
    case 'methodCall': {
      const receiver = evaluateExpr(expr.receiver, env);
      const args = expr.args.map(a => evaluateExpr(a, env));
      // Pass the static receiver/argument types alongside the values: the List
      // methods widen their elements to the result element type, and each
      // source's own static type is the `from` its coercion witness needs.
      return evalMethodCall(
        receiver, expr.method, args,
        expr.receiver.type, expr.args.map(a => a.type), expr.type, expr.span,
      );
    }
    case 'list': {
      // expr.type is List<T>; coerce each element from its own static type to
      // T. Going through the full witness (not just a top-level Int → Float)
      // is what widens a nested element, e.g. a List<Int> element under a
      // List<List<Float>> literal.
      const elemType = expr.type.kind === 'List' ? expr.type.elem : null;
      const elements = expr.elements.map(el => {
        const v = evaluateExpr(el, env);
        return elemType !== null ? coerce(v, el.type, elemType) : v;
      });
      return { type: 'List', elements };
    }
    case 'index': {
      const list = evaluateExpr(expr.list, env);
      const idx = evaluateExpr(expr.index, env);
      if (list.type !== 'List') throw new Error('internal: index receiver not a List');
      if (idx.type !== 'Int') throw new Error('internal: index not an Int');
      const i = Number(idx.value);
      if (i < 0 || i >= list.elements.length) {
        throw new RuntimeError({
          code: 'R0005',
          span: expr.index.span,
          data: { length: String(list.elements.length) },
        });
      }
      return list.elements[i]!;
    }
    case 'unary': {
      const operand = evaluateExpr(expr.operand, env);
      if (expr.op === 'not') {
        if (operand.type !== 'Bool') throw new Error(`internal: 'not' on ${operand.type}`);
        return boolVal(!operand.value);
      }
      if (operand.type === 'Int') return intVal(checkIntOverflow(-operand.value, expr.span));
      if (operand.type === 'Float') return floatVal(checkFiniteFloat(-operand.value, expr.span));
      throw new Error(`internal: unary '-' on ${operand.type}`);
    }
    case 'binary': {
      // 'and'/'or' short-circuit: the left operand alone can decide the
      // result ('False and e' / 'True or e'), so 'e' is only evaluated
      // when it's still needed — the same laziness every mainstream
      // language gives its logical operators.
      if (expr.op === 'and' || expr.op === 'or') {
        const left = evaluateExpr(expr.left, env);
        if (left.type !== 'Bool') throw new Error(`internal: '${expr.op}' on non-Bool`);
        if (expr.op === 'and' ? !left.value : left.value) return left;
        const right = evaluateExpr(expr.right, env);
        if (right.type !== 'Bool') throw new Error(`internal: '${expr.op}' on non-Bool`);
        return right;
      }
      // expr.right.span is where R0002/R0003 point — at the divisor/exponent,
      // not the whole expression (expr.span, used for an overflow result).
      return evaluateBinary(
        expr.op, evaluateExpr(expr.left, env), evaluateExpr(expr.right, env), expr.span, expr.right.span,
      );
    }
    case 'block': {
      return evaluateBlock(expr, env);
    }
    case 'if': {
      const cond = evaluateExpr(expr.cond, env);
      if (cond.type !== 'Bool') throw new Error('internal: if condition not Bool');
      if (cond.value) return evaluateExpr(expr.then, env);
      if (expr.else !== null) return evaluateExpr(expr.else, env);
      return DONE;
    }
  }
};

const evaluateBlock = (block: TypedBlock, env: Environment): RuntimeValue => {
  const blockEnv = env.child();
  let result: RuntimeValue = DONE;
  for (const stmt of block.stmts) {
    result = executeStmt(stmt, blockEnv);
  }
  return result;
};

export const executeStmt = (stmt: TypedStatement, env: Environment): RuntimeValue => {
  switch (stmt.kind) {
    case 'fix':
    case 'mut': {
      // Coerce the init value from its own type to the declared slot type
      // (handles Int → Float when the annotation says Float but the literal is
      // an Int, and any nested widening the same edge implies).
      const value = coerce(evaluateExpr(stmt.init, env), stmt.init.type, stmt.slotType);
      env.declare(stmt.name, value, stmt.kind === 'mut');
      return DONE;
    }
    case 'assign': {
      const value = coerce(evaluateExpr(stmt.value, env), stmt.value.type, stmt.slotType);
      const result = env.assign(stmt.name, value);
      if (result !== 'ok') throw new Error(`internal: assign '${stmt.name}' → ${result}`);
      return DONE;
    }
    case 'expr':
      return evaluateExpr(stmt.expr, env);
    case 'while': {
      // Each iteration evaluates the body as a block, giving it a fresh
      // child scope — a 'fix' from one iteration doesn't leak into the next.
      while (true) {
        const cond = evaluateExpr(stmt.cond, env);
        if (cond.type !== 'Bool') throw new Error('internal: while condition not Bool');
        if (!cond.value) break;
        evaluateBlock(stmt.body, env);
      }
      return DONE;
    }
  }
};

// ---- Method dispatch ------------------------------------------------

const evalIntMethod = (
  receiver: Extract<RuntimeValue, { type: 'Int' }>, method: string, _args: RuntimeValue[], span: Span,
): RuntimeValue => {
  switch (method) {
    case 'toString': return strVal(String(receiver.value));
    case 'toFloat': return floatVal(Number(receiver.value));
    // abs(INT_MIN) has no representable Int result (its magnitude is one past
    // INT_MAX) — the classic two's-complement overflow case.
    case 'abs': return intVal(checkIntOverflow(receiver.value < 0n ? -receiver.value : receiver.value, span));
    default: throw new Error(`internal: Int has no method '${method}'`);
  }
};

const evalFloatMethod = (
  receiver: Extract<RuntimeValue, { type: 'Float' }>, method: string, args: RuntimeValue[], span: Span,
): RuntimeValue => {
  switch (method) {
    case 'toString': return strVal(formatFloat(receiver.value));
    case 'toInt': return intVal(checkIntOverflow(BigInt(Math.trunc(receiver.value)), span));
    case 'abs': return floatVal(Math.abs(receiver.value));
    case 'min': {
      const r = args[0]!;
      return floatVal(Math.min(receiver.value, r.type === 'Int' ? Number(r.value) : (r as Extract<RuntimeValue, { type: 'Float' }>).value));
    }
    case 'max': {
      const r = args[0]!;
      return floatVal(Math.max(receiver.value, r.type === 'Int' ? Number(r.value) : (r as Extract<RuntimeValue, { type: 'Float' }>).value));
    }
    default: throw new Error(`internal: Float has no method '${method}'`);
  }
};

const evalListMethod = (
  receiver: Extract<RuntimeValue, { type: 'List' }>,
  method: string, args: RuntimeValue[],
  receiverType: AscentType, argTypes: AscentType[], resultType: AscentType,
): RuntimeValue => {
  // A List-returning method widens every element to the result's element type
  // (e.g. appending a Float to a List<Int> yields List<Float>). Each source —
  // the receiver's own elements, or a value that came from an argument —
  // carries its own static type, so each gets its own coercion witness; the
  // checker has already proven every one subtypes the result element type.
  // length/isEmpty don't return a List, so resultElem is null and nothing is
  // coerced.
  const resultElem = resultType.kind === 'List' ? resultType.elem : null;
  const recvElem = receiverType.kind === 'List' ? receiverType.elem : null;
  const coerceRecv = (v: RuntimeValue): RuntimeValue =>
    resultElem !== null && recvElem !== null ? coerce(v, recvElem, resultElem) : v;

  switch (method) {
    case 'length': return intVal(BigInt(receiver.elements.length));
    case 'isEmpty': return boolVal(receiver.elements.length === 0);
    case 'reverse': return { type: 'List', elements: [...receiver.elements].reverse().map(coerceRecv) };
    case 'append':
      return { type: 'List', elements: [...receiver.elements.map(coerceRecv), coerce(args[0]!, argTypes[0]!, resultElem!)] };
    case 'prepend':
      return { type: 'List', elements: [coerce(args[0]!, argTypes[0]!, resultElem!), ...receiver.elements.map(coerceRecv)] };
    case 'concat': {
      const other = args[0]! as Extract<RuntimeValue, { type: 'List' }>;
      // The argument is itself a List; its elements coerce from *its* element
      // type to the result's, which can differ from the receiver's edge (e.g.
      // List<Float>.concat(List<Int>) widens the argument, not the receiver).
      const otherType = argTypes[0]!;
      const otherElem = otherType.kind === 'List' ? otherType.elem : null;
      const coerceOther = (v: RuntimeValue): RuntimeValue =>
        resultElem !== null && otherElem !== null ? coerce(v, otherElem, resultElem) : v;
      return {
        type: 'List',
        elements: [...receiver.elements.map(coerceRecv), ...other.elements.map(coerceOther)],
      };
    }
    default: throw new Error(`internal: List has no method '${method}'`);
  }
};

// design.md §4/§9: no integer indexing on String — first/last/slice work in
// graphemes and crash (bug tier, like list '[ ]') rather than lie about what
// they return, exactly the reasoning that already governs List indexing.
const evalStringMethod = (
  receiver: Extract<RuntimeValue, { type: 'String' }>, method: string, args: RuntimeValue[], span: Span,
): RuntimeValue => {
  switch (method) {
    case 'length': return intVal(BigInt(graphemesOf(receiver.value).length));
    case 'first':
    case 'last': {
      // design.md §4: returns String? — None on an empty String, never a
      // crash, since an empty receiver is an expected case here, not a bug.
      const chars = graphemesOf(receiver.value);
      if (chars.length === 0) return NONE;
      return strVal(method === 'first' ? chars[0]! : chars[chars.length - 1]!);
    }
    case 'chars':
      return { type: 'List', elements: graphemesOf(receiver.value).map((c): RuntimeValue => strVal(c)) };
    case 'slice': {
      const chars = graphemesOf(receiver.value);
      const start = Number((args[0] as Extract<RuntimeValue, { type: 'Int' }>).value);
      const end = Number((args[1] as Extract<RuntimeValue, { type: 'Int' }>).value);
      if (start < 0 || end > chars.length || start > end) {
        throw new RuntimeError({
          code: 'R0007',
          span,
          data: { start: String(start), end: String(end), length: String(chars.length) },
        });
      }
      return strVal(chars.slice(start, end).join(''));
    }
    case 'repeat': {
      const count = (args[0] as Extract<RuntimeValue, { type: 'Int' }>).value;
      if (count < 0n) {
        throw new RuntimeError({ code: 'R0008', span, data: { count: String(count) } });
      }
      return strVal(receiver.value.repeat(Number(count)));
    }
    case 'trim':
      return strVal(receiver.value.trim());
    case 'padLeft': {
      const target = Number((args[0] as Extract<RuntimeValue, { type: 'Int' }>).value);
      const padCount = Math.max(0, target - graphemesOf(receiver.value).length);
      return strVal(' '.repeat(padCount) + receiver.value);
    }
    default: throw new Error(`internal: String has no method '${method}'`);
  }
};

const evalMethodCall = (
  receiver: RuntimeValue, method: string, args: RuntimeValue[],
  receiverType: AscentType, argTypes: AscentType[], resultType: AscentType, span: Span,
): RuntimeValue => {
  switch (receiver.type) {
    case 'Int': return evalIntMethod(receiver, method, args, span);
    case 'Float': return evalFloatMethod(receiver, method, args, span);
    case 'String': return evalStringMethod(receiver, method, args, span);
    case 'List': return evalListMethod(receiver, method, args, receiverType, argTypes, resultType);
    default: throw new Error(`internal: ${receiver.type} has no methods`);
  }
};

// Bound to one program's `args`: `set` rejects a name that isn't one of
// those args (which, coming from a parsed program, are already legal slot
// names — no separate syntax check needed), and a value whose type doesn't
// match the arg's declared type.
export class ProgramInputs {
  private readonly argDefs: Map<string, ProgramArg>;
  private readonly values = new Map<string, ScalarValue>();

  public constructor(argDefs: ProgramArg[]) {
    this.argDefs = new Map(argDefs.map(def => [def.name, def]));
  }

  public set(name: string, value: ScalarValue): this {
    const argDef = this.argDefs.get(name);
    if (argDef === undefined) {
      throw new Error(`'${name}' is not a declared program input`);
    }
    if (argDef.type !== value.type) {
      throw new Error(`'${name}': expected ${argDef.type}, got ${value.type}`);
    }
    this.values.set(name, value);
    return this;
  }

  public get(name: string): ScalarValue | undefined {
    return this.values.get(name);
  }
}

// The outcome of a whole program run: either the value it produced, or the
// RuntimeError (§9's bug tier) that crashed it. A caller reads `kind` off the
// return value instead of wrapping the call in try/catch; an internal
// invariant violation (a plain Error, not a RuntimeError) still propagates as
// an exception, since that's a bug in the interpreter, not a modeled outcome.
export type RuntimeResult =
  | { kind: 'ok'; value: RuntimeValue }
  | { kind: 'error'; error: RuntimeError };

// Creates the top-level Environment itself, declaring each of the program's
// `args` as a fixed slot from `inputs` — callers provide values, not scopes.
export const executeProgram = (
  program: TypedProgram,
  inputs: ProgramInputs = new ProgramInputs(program.args),
): RuntimeResult => {
  const env = new Environment();
  for (const arg of program.args) {
    const value = inputs.get(arg.name);
    if (value === undefined) throw new Error(`missing input '${arg.name}'`);
    env.declare(arg.name, value, false);
  }

  try {
    let result: RuntimeValue = DONE;
    for (const stmt of program.stmts) {
      result = executeStmt(stmt, env);
    }
    return { kind: 'ok', value: result };
  } catch (e) {
    if (e instanceof RuntimeError) return { kind: 'error', error: e };
    throw e;
  }
};
