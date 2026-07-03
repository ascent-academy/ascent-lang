import type { BinaryOp, Expr, Literal, Statement } from './ast.js';

export type RuntimeValue = (
  | { type: 'Int'; value: bigint }
  | { type: 'Float'; value: number }
  | { type: 'Bool'; value: boolean }
  | { type: 'String'; value: string }
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
    if (!binding.mutable) {
      return 'immutable';
    }
    binding.value = value;
    return 'ok';
  }

  public child(): Environment {
    return new Environment(this);
  }
}

export const evaluateLiteral = (literal: Literal): RuntimeValue => {
  switch (literal.type) {
    case 'Int':
      return { type: 'Int', value: literal.value };
    case 'Float':
      return { type: 'Float', value: literal.value };
    case 'Bool':
      return { type: 'Bool', value: literal.value };
    case 'String':
      return { type: 'String', value: literal.value };
    case 'None':
      return { type: 'None' };
    case 'Done':
      return { type: 'Done' };
  }
};

type Builtin = (args: RuntimeValue[]) => RuntimeValue;

const BUILTINS: Record<string, Builtin> = {
  floor: (args) => {
    if (args.length !== 1) throw new Error(`floor expects 1 argument, got ${args.length}`);
    const arg = args[0]!;
    if (arg.type !== 'Float') throw new Error(`floor expects Float, got ${arg.type}`);
    return { type: 'Float', value: Math.floor(arg.value) };
  },
};

export const evaluateExpr = (expr: Expr, env: Environment): RuntimeValue => {
  switch (expr.kind) {
    case 'literal':
      return evaluateLiteral(expr);
    case 'slot': {
      const value = env.get(expr.name);
      if (value === undefined) {
        throw new Error(`N0001: undefined slot '${expr.name}'`);
      }
      return value;
    }
    case 'call': {
      const fn = BUILTINS[expr.callee];
      if (fn === undefined) throw new Error(`N0001: undefined function '${expr.callee}'`);
      return fn(expr.args.map(arg => evaluateExpr(arg, env)));
    }
    case 'unary': {
      const operand = evaluateExpr(expr.operand, env);
      if (operand.type === 'Int') return { type: 'Int', value: -operand.value };
      if (operand.type === 'Float') return { type: 'Float', value: -operand.value };
      throw new Error(`unary '-' is not defined for ${operand.type}`);
    }
    case 'binary':
      return evaluateBinary(expr.op, evaluateExpr(expr.left, env), evaluateExpr(expr.right, env));
    case 'block': {
      // Each block gets its own scope, so slots it declares don't leak
      // into the enclosing one. An empty block has no last statement,
      // so it falls through to Done — the '{}' unit value.
      const blockEnv = env.child();
      let result: RuntimeValue = { type: 'Done' };
      for (const stmt of expr.stmts) {
        result = executeStmt(stmt, blockEnv);
      }
      return result;
    }
    case 'if': {
      const cond = evaluateExpr(expr.cond, env);
      if (cond.type !== 'Bool') {
        throw new Error(`if condition must be Bool, got ${cond.type}`);
      }
      if (cond.value) {
        return evaluateExpr(expr.then, env);
      }
      if (expr.else !== null) {
        return evaluateExpr(expr.else, env);
      }
      return { type: 'Done' };
    }
  }
};

export const executeStmt = (stmt: Statement, env: Environment): RuntimeValue => {
  switch (stmt.kind) {
    case 'fix': {
      const boundValue = evaluateExpr(stmt.init, env);
      env.declare(stmt.name, boundValue, false);
      return { type: 'Done' };
    }
    case 'mut': {
      const boundValue = evaluateExpr(stmt.init, env);
      env.declare(stmt.name, boundValue, true);
      return { type: 'Done' };
    }
    case 'assign': {
      const value = evaluateExpr(stmt.value, env);
      const result = env.assign(stmt.name, value);
      if (result === 'undeclared') {
        throw new Error(`N0001: undefined slot '${stmt.name}'`);
      }
      if (result === 'immutable') {
        throw new Error(`N0002: cannot assign to '${stmt.name}' — it was declared with 'fix', which never changes`);
      }
      return { type: 'Done' };
    }
    case 'expr': {
      return evaluateExpr(stmt.expr, env);
    }
    case 'while': {
      // Evaluating the body as a Block (rather than looping over its
      // statements here) reuses the block case's own env.child() call,
      // so every iteration gets its own fresh scope — a 'fix' from one
      // iteration doesn't leak into the next, exactly as if it were a
      // fresh block each time round.
      while (true) {
        const cond = evaluateExpr(stmt.cond, env);
        if (cond.type !== 'Bool') {
          throw new Error(`while condition must be Bool, got ${cond.type}`);
        }
        if (!cond.value) {
          break;
        }
        evaluateExpr(stmt.body, env);
      }
      return { type: 'Done' };
    }
  }
};

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
  if (mod !== 0n && (mod < 0n) !== (b < 0n)) {
    mod += b;
  }
  return { div: (a - mod) / b, mod };
};

// '==' / '!=' are structural — same-type values compare by their
// contents — except Int meeting Float, which compares as numbers (the
// same one-way promotion arithmetic uses). Two Ints compare exactly, as
// BigInts, rather than going through asFloat and risking the precision
// loss a huge Int would suffer converting to a JS number.
const valuesEqual = (op: '==' | '!=', left: RuntimeValue, right: RuntimeValue): boolean => {
  if (isNumeric(left) && isNumeric(right)) {
    return left.type === 'Int' && right.type === 'Int'
      ? left.value === right.value
      : asFloat(left) === asFloat(right);
  }
  if (left.type !== right.type) {
    throw new Error(`'${op}' is not defined for ${left.type} and ${right.type}`);
  }
  if (left.type === 'Bool' && right.type === 'Bool') {
    return left.value === right.value;
  }
  // None and Done are singleton types — matching type already means equal.
  return true;
};

// '<' '<=' '>' '>=' are Int/Float only for now (String ordering is a
// later section, once String exists as a RuntimeValue) — same one-way
// promotion and exact-Int-comparison rule as '==' above.
const evaluateOrdering = (op: '<' | '<=' | '>' | '>=', left: RuntimeValue, right: RuntimeValue): boolean => {
  if (!isNumeric(left) || !isNumeric(right)) {
    throw new Error(`'${op}' is not defined for ${left.type} and ${right.type}`);
  }

  if (left.type === 'Int' && right.type === 'Int') {
    switch (op) {
      case '<': return left.value < right.value;
      case '<=': return left.value <= right.value;
      case '>': return left.value > right.value;
      case '>=': return left.value >= right.value;
    }
  }

  const l = asFloat(left);
  const r = asFloat(right);
  switch (op) {
    case '<': return l < r;
    case '<=': return l <= r;
    case '>': return l > r;
    case '>=': return l >= r;
  }
};

// Int op Int stays an Int (exact BigInt arithmetic); an Int meeting a
// Float promotes to Float first (the one-way, value-preserving
// Int -> Float rule) so the result is a Float the moment either operand
// is one. Bool/None operands have no defined arithmetic; a real T-code
// diagnostic lands with the type checker (agenda §5/§6) — for now this
// throws rather than silently returning a nonsense value, honouring the
// "no silent failure states" rule even before the proper machinery exists.
const evaluateBinary = (op: BinaryOp, left: RuntimeValue, right: RuntimeValue): RuntimeValue => {
  if (op === '==' || op === '!=') {
    return { type: 'Bool', value: valuesEqual(op, left, right) };
  }
  if (op === '<' || op === '<=' || op === '>' || op === '>=') {
    return { type: 'Bool', value: evaluateOrdering(op, left, right) };
  }

  if (!isNumeric(left) || !isNumeric(right)) {
    throw new Error(`'${op}' is not defined for ${left.type} and ${right.type}`);
  }

  // 'div'/'mod' are Int-only — floor division/modulo answers "how many
  // whole times" and "what's left over", concepts a Float doesn't have.
  if (op === 'div' || op === 'mod') {
    if (left.type !== 'Int' || right.type !== 'Int') {
      throw new Error(`'${op}' requires Int operands, got ${left.type} and ${right.type}`);
    }
    if (right.value === 0n) {
      throw new Error(`${op} by zero`);
    }
    const { div, mod } = floorDivMod(left.value, right.value);
    return { type: 'Int', value: op === 'div' ? div : mod };
  }

  // '/' always yields a Float, whatever the operand types — this is what
  // stops the silent integer-truncation bug (7 / 2 is 3.5, not the 3
  // that C/Java/JS would give). Infinity/NaN aren't values in Ascent
  // (§4), so division by zero is a loud crash rather than a silent one.
  if (op === '/') {
    const divisor = asFloat(right);
    if (divisor === 0) {
      throw new Error('division by zero');
    }
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
