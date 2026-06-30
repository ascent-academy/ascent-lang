import type { Expr } from './ast.js';

export type RuntimeValue = (
  | { type: 'int'; value: bigint }
  | { type: 'float'; value: number }
);

export function evaluate(expr: Expr): RuntimeValue {
  switch (expr.kind) {
    case 'int':
      return { type: 'int', value: expr.value };
    case 'float':
      return { type: 'float', value: expr.value };
  }
}
