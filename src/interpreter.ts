import type { Expr, Statement } from './ast.js';

export type RuntimeValue = (
  | { type: 'int'; value: bigint }
  | { type: 'float'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'none' }
);

export type Environment = Map<string, RuntimeValue>;

export const evaluateExpr = (expr: Expr, env: Environment): RuntimeValue => {
  switch (expr.kind) {
    case 'int':
      return { type: 'int', value: expr.value };
    case 'float':
      return { type: 'float', value: expr.value };
    case 'bool':
      return { type: 'bool', value: expr.value };
    case 'none':
      return { type: 'none' };
    case 'slot': {
      const value = env.get(expr.name);
      if (value === undefined) {
        throw new Error(`N0001: undefined slot '${expr.name}'`);
      }
      return value;
    }
    case 'unary': {
      const operand = evaluateExpr(expr.operand, env);
      if (operand.type === 'int') return { type: 'int', value: -operand.value };
      if (operand.type === 'float') return { type: 'float', value: -operand.value };
      throw new Error(`unary '-' is not defined for ${operand.type}`);
    }
    case 'binary':
      return evaluateBinary(expr.op, evaluateExpr(expr.left, env), evaluateExpr(expr.right, env));
  }
};

export type StmtResult = (
  | { kind: 'fix'; name: string; value: RuntimeValue }
  | { kind: 'expr'; value: RuntimeValue }
);

export const executeStmt = (stmt: Statement, env: Environment): StmtResult => {
  switch (stmt.kind) {
    case 'fix': {
      const value = evaluateExpr(stmt.init, env);
      env.set(stmt.name, value);
      return { kind: 'fix', name: stmt.name, value };
    }
    case 'expr': {
      const value = evaluateExpr(stmt.expr, env);
      return { kind: 'expr', value };
    }
  }
};

type Numeric = { type: 'int'; value: bigint } | { type: 'float'; value: number };
const isNumeric = (v: RuntimeValue): v is Numeric => v.type === 'int' || v.type === 'float';
const asFloat = (v: Numeric): number => (v.type === 'int' ? Number(v.value) : v.value);

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

// Int op Int stays an Int (exact BigInt arithmetic); an Int meeting a
// Float promotes to Float first (the one-way, value-preserving
// Int -> Float rule) so the result is a Float the moment either operand
// is one. Bool/None operands have no defined arithmetic; a real T-code
// diagnostic lands with the type checker (agenda §5/§6) — for now this
// throws rather than silently returning a nonsense value, honouring the
// "no silent failure states" rule even before the proper machinery exists.
const evaluateBinary = (op: '+' | '-' | '*' | '/' | 'div' | 'mod', left: RuntimeValue, right: RuntimeValue): RuntimeValue => {
  if (!isNumeric(left) || !isNumeric(right)) {
    throw new Error(`'${op}' is not defined for ${left.type} and ${right.type}`);
  }

  // 'div'/'mod' are Int-only — floor division/modulo answers "how many
  // whole times" and "what's left over", concepts a Float doesn't have.
  if (op === 'div' || op === 'mod') {
    if (left.type !== 'int' || right.type !== 'int') {
      throw new Error(`'${op}' requires Int operands, got ${left.type} and ${right.type}`);
    }
    if (right.value === 0n) {
      throw new Error(`${op} by zero`);
    }
    const { div, mod } = floorDivMod(left.value, right.value);
    return { type: 'int', value: op === 'div' ? div : mod };
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
    return { type: 'float', value: asFloat(left) / divisor };
  }

  if (left.type === 'int' && right.type === 'int') {
    const v = op === '+' ? left.value + right.value
            : op === '-' ? left.value - right.value
            : left.value * right.value;
    return { type: 'int', value: v };
  }

  const l = asFloat(left);
  const r = asFloat(right);
  const v = op === '+' ? l + r : op === '-' ? l - r : l * r;
  return { type: 'float', value: v };
};
