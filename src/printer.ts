import chalk from 'chalk';
import type { Expr } from './ast.js';
import type { RuntimeValue } from './interpreter.js';

// Returns the node as a list of lines so callers can prefix them with
// branch characters (├─, └─) when embedding inside a parent node.
function exprLines(expr: Expr): string[] {
  switch (expr.kind) {
    case 'Literal':
      return [`${chalk.cyan('Literal')} ${chalk.yellow(String(expr.value))}`];
  }
}

// Prefixes a child's lines with tree-drawing characters.
// Used by parent nodes (Binary, Unary, …) when they are added.
export function branch(lines: string[], isLast: boolean): string[] {
  const head = chalk.dim(isLast ? '└─ ' : '├─ ');
  const body = chalk.dim(isLast ? '   ' : '│  ');
  return lines.map((line, i) => (i === 0 ? head : body) + line);
}

export function formatExpr(expr: Expr): string {
  return exprLines(expr).join('\n');
}

export function formatValue(value: RuntimeValue): string {
  switch (value.type) {
    case 'int':
      return chalk.yellow(String(value.value));
  }
}
