import chalk from 'chalk';
import type { Expr } from './ast.js';
import type { RuntimeValue } from './interpreter.js';

// Returns the node as a list of lines so callers can prefix them with
// branch characters (├─, └─) when embedding inside a parent node.
const exprLines = (expr: Expr): string[] => {
  switch (expr.kind) {
    case 'int':
      return [`${chalk.cyan('Int')} ${chalk.yellow(String(expr.value))}`];
    case 'float':
      return [`${chalk.cyan('Float')} ${chalk.yellow(String(expr.value))}`];
    case 'bool':
      return [`${chalk.cyan('Bool')} ${chalk.yellow(String(expr.value))}`];
    case 'none':
      return [`${chalk.cyan('None')}`];
    case 'binary': {
      const left = branch(exprLines(expr.left), false);
      const right = branch(exprLines(expr.right), true);
      return [`${chalk.cyan('Binary')} ${chalk.magenta(expr.op)}`, ...left, ...right];
    }
  }
};

// Prefixes a child's lines with tree-drawing characters.
// Used by parent nodes (Binary, Unary, …) when they are added.
export const branch = (lines: string[], isLast: boolean): string[] => {
  const head = chalk.dim(isLast ? '└─ ' : '├─ ');
  const body = chalk.dim(isLast ? '   ' : '│  ');
  return lines.map((line, i) => (i === 0 ? head : body) + line);
};

export const formatExpr = (expr: Expr): string => {
  return exprLines(expr).join('\n');
};

export const formatValue = (value: RuntimeValue): string => {
  switch (value.type) {
    case 'int':
      return chalk.yellow(String(value.value));
    case 'float':
      const floatStr = String(value.value);
      return floatStr.includes('.') ? chalk.yellow(floatStr) : chalk.yellow(floatStr + '.0');
    case 'bool':
      return chalk.yellow(String(value.value));
    case 'none':
      return chalk.yellow('none');
  }
};
