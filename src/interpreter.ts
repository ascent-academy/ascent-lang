import type { Expr } from './ast.js';

export type RuntimeValue = (
  | { type: 'int'; value: bigint }
  | { type: 'float'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'none' }
);

export const evaluate = (expr: Expr): RuntimeValue => {
  switch (expr.kind) {
    case 'int':
      return { type: 'int', value: expr.value };
    case 'float':
      return { type: 'float', value: expr.value };
    case 'bool':
      return { type: 'bool', value: expr.value };
    case 'none':
      return { type: 'none' };
    case 'binary':
      return evaluateBinary(expr.op, evaluate(expr.left), evaluate(expr.right));
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
const evaluateBinary = (op: '+' | '*' | '/' | 'div' | 'mod', left: RuntimeValue, right: RuntimeValue): RuntimeValue => {
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
    return { type: 'int', value: op === '+' ? left.value + right.value : left.value * right.value };
  }

  const l = asFloat(left);
  const r = asFloat(right);
  return { type: 'float', value: op === '+' ? l + r : l * r };
};
