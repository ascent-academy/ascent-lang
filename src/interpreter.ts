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
  }
}
