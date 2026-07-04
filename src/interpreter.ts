import type { BinaryOp } from './parser/ast.js';
import type { TypedExpr, TypedBlock, TypedStatement, TypedProgram } from './parser/typed-ast.js';
import type { Type } from './parser/types.js';

export type RuntimeValue = (
  | { type: 'Int'; value: bigint }
  | { type: 'Float'; value: number }
  | { type: 'Bool'; value: boolean }
  | { type: 'String'; value: string }
  | { type: 'List'; elements: RuntimeValue[] }
  | { type: 'None' }
  | { type: 'Done' }
);

type Binding = { value: RuntimeValue; mutable: boolean };

export type AssignResult = 'ok' | 'immutable' | 'undeclared';

// A chain of scopes, one per block. A lookup (or assignment) walks
// outward through parents; a declaration always writes to the current
// (innermost) scope, so a 'fix'/'mut' inside a block shadows an outer
// slot of the same name without touching it, and the shadow disappears
// once the block ends.
export class Environment {
  private readonly vars = new Map<string, Binding>();

  public constructor(private readonly parent: Environment | null = null) { }

  public get(name: string): RuntimeValue | undefined {
    return this.vars.get(name)?.value ?? this.parent?.get(name);
  }

  public declare(name: string, value: RuntimeValue, mutable: boolean): void {
    this.vars.set(name, { value, mutable });
  }

  // Reassigns a slot in whichever scope actually owns it (not
  // necessarily this one), mutating the binding in place so every
  // Environment sharing this chain sees the new value immediately —
  // this is what lets a 'while' loop's condition observe a slot its
  // body just changed.
  public assign(name: string, value: RuntimeValue): AssignResult {
    const binding = this.vars.get(name);
    if (binding === undefined) {
      return this.parent?.assign(name, value) ?? 'undeclared';
    }
    if (!binding.mutable) return 'immutable';
    binding.value = value;
    return 'ok';
  }

  public child(): Environment {
    return new Environment(this);
  }
}

// Coerce a runtime value to match a target type when the target is Float
// and the value is Int — the only implicit widening the language allows.
// All other type conversions are explicit (methods like toFloat/toInt).
const coerce = (v: RuntimeValue, targetType: Type): RuntimeValue => {
  if (targetType.kind === 'Float' && v.type === 'Int') {
    return { type: 'Float', value: Number(v.value) };
  }
  return v;
};

export const evaluateExpr = (expr: TypedExpr, env: Environment): RuntimeValue => {
  switch (expr.kind) {
    case 'literal': {
      switch (expr.type) {
        case 'Int': return { type: 'Int', value: expr.value };
        case 'Float': return { type: 'Float', value: expr.value };
        case 'Bool': return { type: 'Bool', value: expr.value };
        case 'String': return { type: 'String', value: expr.value };
        case 'None': return { type: 'None' };
        case 'Done': return { type: 'Done' };
      }
    }
    case 'slot': {
      // N0001 / N0002 are caught at type-check time; this is an internal guard.
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
        return { type: 'Float', value: Math.floor(arg.value) };
      }
      throw new Error(`internal: unknown built-in '${expr.callee}'`);
    }
    case 'methodCall': {
      const receiver = evaluateExpr(expr.receiver, env);
      const args = expr.args.map(a => evaluateExpr(a, env));
      return evalMethodCall(receiver, expr.method, args, expr.ty);
    }
    case 'list': {
      // expr.ty is List<T>; coerce each element to T (handles Int → Float).
      const elemType = expr.ty.kind === 'List' ? expr.ty.elem : null;
      const elements = expr.elements.map(el => {
        const v = evaluateExpr(el, env);
        return elemType !== null ? coerce(v, elemType) : v;
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
        throw new Error(`index ${i} out of bounds (length ${list.elements.length})`);
      }
      return list.elements[i]!;
    }
    case 'unary': {
      const operand = evaluateExpr(expr.operand, env);
      if (operand.type === 'Int') return { type: 'Int', value: -operand.value };
      if (operand.type === 'Float') return { type: 'Float', value: -operand.value };
      throw new Error(`internal: unary '-' on ${operand.type}`);
    }
    case 'binary':
      return evaluateBinary(expr.op, evaluateExpr(expr.left, env), evaluateExpr(expr.right, env));
    case 'block': {
      return evaluateBlock(expr, env);
    }
    case 'if': {
      const cond = evaluateExpr(expr.cond, env);
      if (cond.type !== 'Bool') throw new Error('internal: if condition not Bool');
      if (cond.value) return evaluateExpr(expr.then, env);
      if (expr.else !== null) return evaluateExpr(expr.else, env);
      return { type: 'Done' };
    }
  }
};

const evaluateBlock = (block: TypedBlock, env: Environment): RuntimeValue => {
  const blockEnv = env.child();
  let result: RuntimeValue = { type: 'Done' };
  for (const stmt of block.stmts) {
    result = executeStmt(stmt, blockEnv);
  }
  return result;
};

export const executeStmt = (stmt: TypedStatement, env: Environment): RuntimeValue => {
  switch (stmt.kind) {
    case 'fix':
    case 'mut': {
      // Coerce the init value to the declared slot type (handles Int → Float
      // when the annotation says Float but the literal is an Int).
      const value = coerce(evaluateExpr(stmt.init, env), stmt.slotType);
      env.declare(stmt.name, value, stmt.kind === 'mut');
      return { type: 'Done' };
    }
    case 'assign': {
      const value = coerce(evaluateExpr(stmt.value, env), stmt.slotType);
      const result = env.assign(stmt.name, value);
      if (result !== 'ok') throw new Error(`internal: assign '${stmt.name}' → ${result}`);
      return { type: 'Done' };
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
      return { type: 'Done' };
    }
  }
};

// ---- Method dispatch ------------------------------------------------

const evalIntMethod = (receiver: Extract<RuntimeValue, { type: 'Int' }>, method: string, _args: RuntimeValue[]): RuntimeValue => {
  switch (method) {
    case 'toStr': return { type: 'String', value: String(receiver.value) };
    case 'toFloat': return { type: 'Float', value: Number(receiver.value) };
    case 'abs': return { type: 'Int', value: receiver.value < 0n ? -receiver.value : receiver.value };
    default: throw new Error(`internal: Int has no method '${method}'`);
  }
};

const evalFloatMethod = (receiver: Extract<RuntimeValue, { type: 'Float' }>, method: string, args: RuntimeValue[]): RuntimeValue => {
  switch (method) {
    case 'toStr': return { type: 'String', value: String(receiver.value) };
    case 'toInt': return { type: 'Int', value: BigInt(Math.trunc(receiver.value)) };
    case 'abs': return { type: 'Float', value: Math.abs(receiver.value) };
    case 'min': {
      const r = args[0]!;
      return { type: 'Float', value: Math.min(receiver.value, r.type === 'Int' ? Number(r.value) : (r as Extract<RuntimeValue, { type: 'Float' }>).value) };
    }
    case 'max': {
      const r = args[0]!;
      return { type: 'Float', value: Math.max(receiver.value, r.type === 'Int' ? Number(r.value) : (r as Extract<RuntimeValue, { type: 'Float' }>).value) };
    }
    default: throw new Error(`internal: Float has no method '${method}'`);
  }
};

const evalListMethod = (
  receiver: Extract<RuntimeValue, { type: 'List' }>,
  method: string, args: RuntimeValue[], resultType: Type,
): RuntimeValue => {
  // For methods that return a List, resultType.elem is the element type to
  // coerce to (handles Int → Float when the list widens, e.g. after concat).
  const elemType = resultType.kind === 'List' ? resultType.elem : null;
  const coerceElem = (v: RuntimeValue) => elemType !== null ? coerce(v, elemType) : v;

  switch (method) {
    case 'length': return { type: 'Int', value: BigInt(receiver.elements.length) };
    case 'isEmpty': return { type: 'Bool', value: receiver.elements.length === 0 };
    case 'reverse': return { type: 'List', elements: [...receiver.elements].reverse().map(coerceElem) };
    case 'append':
      return { type: 'List', elements: [...receiver.elements.map(coerceElem), coerceElem(args[0]!)] };
    case 'prepend':
      return { type: 'List', elements: [coerceElem(args[0]!), ...receiver.elements.map(coerceElem)] };
    case 'concat': {
      const other = args[0]! as Extract<RuntimeValue, { type: 'List' }>;
      return {
        type: 'List',
        elements: [...receiver.elements.map(coerceElem), ...other.elements.map(coerceElem)],
      };
    }
    default: throw new Error(`internal: List has no method '${method}'`);
  }
};

const evalMethodCall = (
  receiver: RuntimeValue, method: string, args: RuntimeValue[], resultType: Type,
): RuntimeValue => {
  switch (receiver.type) {
    case 'Int': return evalIntMethod(receiver, method, args);
    case 'Float': return evalFloatMethod(receiver, method, args);
    case 'List': return evalListMethod(receiver, method, args, resultType);
    default: throw new Error(`internal: ${receiver.type} has no methods`);
  }
};

// ---- Binary operators -----------------------------------------------

type Numeric = { type: 'Int'; value: bigint } | { type: 'Float'; value: number };
const isNumeric = (v: RuntimeValue): v is Numeric => v.type === 'Int' || v.type === 'Float';
const asFloat = (v: Numeric): number => (v.type === 'Int' ? Number(v.value) : v.value);

// BigInt's own '%' truncates toward zero (remainder takes the sign of
// the dividend, like C/Java/JS). 'mod' instead floors — the result
// takes the sign of the divisor — so a single correction pass covers
// the case where the truncating remainder landed on the wrong side of
// zero. 'div' is then defined from 'mod' so the identity
// `(a div b) * b + (a mod b) == a` holds by construction.
const floorDivMod = (a: bigint, b: bigint): { div: bigint; mod: bigint } => {
  let mod = a % b;
  if (mod !== 0n && (mod < 0n) !== (b < 0n)) mod += b;
  return { div: (a - mod) / b, mod };
};

// '==' / '!=' are structural — same-type values compare by their
// contents — except Int meeting Float, which compares as numbers (the
// same one-way promotion arithmetic uses). Two Ints compare exactly, as
// BigInts, rather than going through asFloat and risking the precision
// loss a huge Int would suffer converting to a JS number.
const valuesEqual = (left: RuntimeValue, right: RuntimeValue): boolean => {
  if (isNumeric(left) && isNumeric(right)) {
    return left.type === 'Int' && right.type === 'Int'
      ? left.value === right.value
      : asFloat(left) === asFloat(right);
  }
  if (left.type !== right.type) return false;
  if (left.type === 'Bool' && right.type === 'Bool') return left.value === right.value;
  if (left.type === 'String' && right.type === 'String') return left.value === right.value;
  return true; // None, Done — singleton types
};

const evaluateBinary = (op: BinaryOp, left: RuntimeValue, right: RuntimeValue): RuntimeValue => {
  if (op === '==' || op === '!=') {
    const eq = valuesEqual(left, right);
    return { type: 'Bool', value: op === '==' ? eq : !eq };
  }

  if (!isNumeric(left) || !isNumeric(right)) throw new Error(`internal: '${op}' on non-numeric`);

  if (op === '<' || op === '<=' || op === '>' || op === '>=') {
    const useInt = left.type === 'Int' && right.type === 'Int';
    const l = useInt ? left.value : asFloat(left);
    const r = useInt ? right.value : asFloat(right);
    const result = op === '<' ? l < r : op === '<=' ? l <= r : op === '>' ? l > r : l >= r;
    return { type: 'Bool', value: result };
  }

  if (op === 'div' || op === 'mod') {
    if (left.type !== 'Int' || right.type !== 'Int') throw new Error(`internal: '${op}' on non-Int`);
    if (right.value === 0n) throw new Error(`${op} by zero`);
    const { div, mod } = floorDivMod(left.value, right.value);
    return { type: 'Int', value: op === 'div' ? div : mod };
  }

  if (op === '/') {
    const divisor = asFloat(right);
    if (divisor === 0) throw new Error('division by zero');
    return { type: 'Float', value: asFloat(left) / divisor };
  }

  if (left.type === 'Int' && right.type === 'Int') {
    const v = op === '+' ? left.value + right.value
      : op === '-' ? left.value - right.value
        : left.value * right.value;
    return { type: 'Int', value: v };
  }

  const l = asFloat(left);
  const r = asFloat(right);
  const v = op === '+' ? l + r : op === '-' ? l - r : l * r;
  return { type: 'Float', value: v };
};

export const executeProgram = (program: TypedProgram, env: Environment): RuntimeValue => {
  let result: RuntimeValue = { type: 'Done' };
  for (const stmt of program.stmts) {
    result = executeStmt(stmt, env);
  }
  return result;
};
