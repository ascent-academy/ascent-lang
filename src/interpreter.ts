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

// Int op Int stays an Int (exact BigInt arithmetic); an Int meeting a
// Float promotes to Float first (the one-way, value-preserving
// Int -> Float rule) so the result is a Float the moment either operand
// is one. Bool/None operands have no defined arithmetic; a real T-code
// diagnostic lands with the type checker (agenda §5/§6) — for now this
// throws rather than silently returning a nonsense value, honouring the
// "no silent failure states" rule even before the proper machinery exists.
const evaluateBinary = (op: '+' | '*', left: RuntimeValue, right: RuntimeValue): RuntimeValue => {
  if (left.type === 'int' && right.type === 'int') {
    return { type: 'int', value: op === '+' ? left.value + right.value : left.value * right.value };
  }

  if ((left.type === 'int' || left.type === 'float') &&
      (right.type === 'int' || right.type === 'float')) {
    const asFloat = (v: { type: 'int'; value: bigint } | { type: 'float'; value: number }): number =>
      v.type === 'int' ? Number(v.value) : v.value;
    const l = asFloat(left);
    const r = asFloat(right);
    return { type: 'float', value: op === '+' ? l + r : l * r };
  }

  throw new Error(`'${op}' is not defined for ${left.type} and ${right.type}`);
};
