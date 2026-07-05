import type { ProgramArg } from './parser/ast.js';
import type { TypedExpr, TypedBlock, TypedStatement, TypedProgram } from './parser/typed-ast.js';
import type { Span } from './lexer/token.js';
import { INT_TYPE, subtype, type AscentType } from './types/types.js';
import { RuntimeError } from './errors/runtime-error.js';

// Int is a 64-bit signed whole number (design.md §4): it traps on overflow
// rather than silently wrapping around.
const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 63n - 1n;

const checkIntOverflow = (value: bigint, span: Span): bigint => {
  if (value < INT_MIN || value > INT_MAX) {
    throw new RuntimeError({ code: 'R0001', span });
  }
  return value;
};

// Every Float is a real, ordered number (design.md §4) — NaN/Infinity never
// exist as a value, so any operation that would produce one crashes instead.
const checkFiniteFloat = (value: number, span: Span): number => {
  if (!Number.isFinite(value)) {
    throw new RuntimeError({ code: 'R0004', span });
  }
  return value;
};

export type PrimitiveValue = (
  | { type: 'Int'; value: bigint }
  | { type: 'Float'; value: number }
  | { type: 'Bool'; value: boolean }
  | { type: 'String'; value: string }
);

export type RuntimeValue = (
  | PrimitiveValue
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

// Coerce a runtime value to match a target type, per the witness `subtype`
// produces — currently only Int <: Float, so only an Int value ever moves.
// All other type conversions are explicit (methods like toFloat/toInt).
const coerce = (v: RuntimeValue, targetType: AscentType): RuntimeValue => {
  if (v.type === 'Int' && subtype(INT_TYPE, targetType) === 'intToFloat') {
    return { type: 'Float', value: Number(v.value) };
  }
  return v;
};

// Float's canonical string form always shows the decimal point, so a whole
// number stays visibly a Float (`3.0`, never collapsed to `3` like an Int).
const formatFloat = (value: number): string => {
  const s = String(value);
  return /[.e]/i.test(s) ? s : `${s}.0`;
};

// How a scalar shows as text inside a '${ }' hole — hardcoded until a
// Show-style trait exists (see isScalarType in types/types.ts, which the
// typechecker uses to guarantee `v` is one of these four cases here). Mirrors
// Int/Float's own '.toStr()' method exactly, so writing it explicitly in a
// hole is redundant, never different.
const scalarToStr = (v: RuntimeValue): string => {
  switch (v.type) {
    case 'Int': return String(v.value);
    case 'Float': return formatFloat(v.value);
    case 'Bool': return v.value ? 'True' : 'False';
    case 'String': return v.value;
    default: throw new Error(`internal: ${v.type} in an interpolation hole (typechecker should have rejected it)`);
  }
};

export const evaluateExpr = (expr: TypedExpr, env: Environment): RuntimeValue => {
  switch (expr.kind) {
    case 'literal': {
      switch (expr.valueType) {
        case 'Int': return { type: 'Int', value: checkIntOverflow(expr.value, expr.span) };
        case 'Float': return { type: 'Float', value: checkFiniteFloat(expr.value, expr.span) };
        case 'Bool': return { type: 'Bool', value: expr.value };
        case 'String': return { type: 'String', value: expr.value };
        case 'None': return { type: 'None' };
        case 'Done': return { type: 'Done' };
      }
    }
    case 'template': {
      let result = '';
      for (const part of expr.parts) {
        if (part.kind === 'text') { result += part.value; continue; }
        result += scalarToStr(evaluateExpr(part.expr, env));
      }
      return { type: 'String', value: result };
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
        return { type: 'Float', value: Math.floor(arg.value) };
      }
      throw new Error(`internal: unknown built-in '${expr.callee}'`);
    }
    case 'methodCall': {
      const receiver = evaluateExpr(expr.receiver, env);
      const args = expr.args.map(a => evaluateExpr(a, env));
      return evalMethodCall(receiver, expr.method, args, expr.type, expr.span);
    }
    case 'list': {
      // expr.type is List<T>; coerce each element to T (handles Int → Float).
      const elemType = expr.type.kind === 'List' ? expr.type.elem : null;
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
        return { type: 'Bool', value: !operand.value };
      }
      if (operand.type === 'Int') return { type: 'Int', value: checkIntOverflow(-operand.value, expr.span) };
      if (operand.type === 'Float') return { type: 'Float', value: checkFiniteFloat(-operand.value, expr.span) };
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
      return evaluateBinary(expr, evaluateExpr(expr.left, env), evaluateExpr(expr.right, env));
    }
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

const evalIntMethod = (
  receiver: Extract<RuntimeValue, { type: 'Int' }>, method: string, _args: RuntimeValue[], span: Span,
): RuntimeValue => {
  switch (method) {
    case 'toStr': return { type: 'String', value: String(receiver.value) };
    case 'toFloat': return { type: 'Float', value: Number(receiver.value) };
    // abs(INT_MIN) has no representable Int result (its magnitude is one past
    // INT_MAX) — the classic two's-complement overflow case.
    case 'abs': return { type: 'Int', value: checkIntOverflow(receiver.value < 0n ? -receiver.value : receiver.value, span) };
    default: throw new Error(`internal: Int has no method '${method}'`);
  }
};

const evalFloatMethod = (
  receiver: Extract<RuntimeValue, { type: 'Float' }>, method: string, args: RuntimeValue[], span: Span,
): RuntimeValue => {
  switch (method) {
    case 'toStr': return { type: 'String', value: formatFloat(receiver.value) };
    case 'toInt': return { type: 'Int', value: checkIntOverflow(BigInt(Math.trunc(receiver.value)), span) };
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
  method: string, args: RuntimeValue[], resultType: AscentType,
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
  receiver: RuntimeValue, method: string, args: RuntimeValue[], resultType: AscentType, span: Span,
): RuntimeValue => {
  switch (receiver.type) {
    case 'Int': return evalIntMethod(receiver, method, args, span);
    case 'Float': return evalFloatMethod(receiver, method, args, span);
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

type BinaryExpr = Extract<TypedExpr, { kind: 'binary' }>;

const evaluateBinary = (expr: BinaryExpr, left: RuntimeValue, right: RuntimeValue): RuntimeValue => {
  const { op, span } = expr;

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
    if (right.value === 0n) throw new RuntimeError({ code: 'R0002', span: expr.right.span });
    const { div, mod } = floorDivMod(left.value, right.value);
    // INT_MIN div -1 is the one 'div'/'mod' case that can overflow: its exact
    // result (INT_MAX + 1) has no representable Int.
    return { type: 'Int', value: checkIntOverflow(op === 'div' ? div : mod, span) };
  }

  if (op === '/') {
    const divisor = asFloat(right);
    if (divisor === 0) throw new RuntimeError({ code: 'R0002', span: expr.right.span });
    return { type: 'Float', value: checkFiniteFloat(asFloat(left) / divisor, span) };
  }

  if (op === '**') {
    if (left.type === 'Int' && right.type === 'Int') {
      // The result type is fixed at Int ** Int -> Int regardless of the
      // exponent's runtime sign (§5), so a negative exponent — which would
      // need a fractional result — can't be silently truncated; it crashes.
      if (right.value < 0n) {
        throw new RuntimeError({ code: 'R0003', span: expr.right.span });
      }
      return { type: 'Int', value: checkIntOverflow(left.value ** right.value, span) };
    }
    return { type: 'Float', value: checkFiniteFloat(Math.pow(asFloat(left), asFloat(right)), span) };
  }

  if (left.type === 'Int' && right.type === 'Int') {
    const v = op === '+' ? left.value + right.value
      : op === '-' ? left.value - right.value
        : left.value * right.value;
    return { type: 'Int', value: checkIntOverflow(v, span) };
  }

  const l = asFloat(left);
  const r = asFloat(right);
  const v = op === '+' ? l + r : op === '-' ? l - r : l * r;
  return { type: 'Float', value: checkFiniteFloat(v, span) };
};

// Bound to one program's `args`: `set` rejects a name that isn't one of
// those args (which, coming from a parsed program, are already legal slot
// names — no separate syntax check needed), and a value whose type doesn't
// match the arg's declared type.
export class ProgramInputs {
  private readonly argDefs: Map<string, ProgramArg>;
  private readonly values = new Map<string, PrimitiveValue>();

  public constructor(argDefs: ProgramArg[]) {
    this.argDefs = new Map(argDefs.map(def => [def.name, def]));
  }

  public set(name: string, value: PrimitiveValue): this {
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

  public get(name: string): PrimitiveValue | undefined {
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
    let result: RuntimeValue = { type: 'Done' };
    for (const stmt of program.stmts) {
      result = executeStmt(stmt, env);
    }
    return { kind: 'ok', value: result };
  } catch (e) {
    if (e instanceof RuntimeError) return { kind: 'error', error: e };
    throw e;
  }
};
