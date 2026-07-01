import type { Expr } from './ast.js';

export type RuntimeValue = (
  | { type: 'int'; value: bigint }
  | { type: 'float'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'none' }
);

export function evaluate(expr: Expr): RuntimeValue {
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
      return evaluateBinary(evaluate(expr.left), evaluate(expr.right));
  }
}

// Int + Int stays an Int (exact BigInt addition); an Int meeting a Float
// promotes to Float first (the one-way, value-preserving Int -> Float
// rule) so the result is a Float the moment either operand is one.
// Bool/None operands have no defined '+' behaviour; a real T-code
// diagnostic lands with the type checker (agenda §5/§6) — for now this
// throws rather than silently returning a nonsense value, honouring the
// "no silent failure states" rule even before the proper machinery exists.
function evaluateBinary(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (left.type === 'int' && right.type === 'int') {
    return { type: 'int', value: left.value + right.value };
  }

  if ((left.type === 'int' || left.type === 'float') &&
      (right.type === 'int' || right.type === 'float')) {
    const asFloat = (v: { type: 'int'; value: bigint } | { type: 'float'; value: number }): number =>
      v.type === 'int' ? Number(v.value) : v.value;
    return { type: 'float', value: asFloat(left) + asFloat(right) };
  }

  throw new Error(`'+' is not defined for ${left.type} and ${right.type}`);
}
