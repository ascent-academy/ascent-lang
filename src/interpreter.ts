import type { Expr } from './ast.js';

export type RuntimeValue =
  | { type: 'int'; value: bigint };

export function evaluate(expr: Expr): RuntimeValue {
  switch (expr.kind) {
    case 'Literal':
      return { type: 'int', value: expr.value };
  }
}
