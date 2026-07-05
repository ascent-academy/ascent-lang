import chalk from 'chalk';
import type { Expr, Statement, TypeExpr } from './ast.js';
import type { RuntimeValue } from '../interpreter.js';

const formatTypeExpr = (te: TypeExpr): string => {
  switch (te.kind) {
    case 'TypeName': return te.name;
    case 'ListType': return `List<${formatTypeExpr(te.elem)}>`;
  }
};

// Returns the node as a list of lines so callers can prefix them with
// branch characters (├─, └─) when embedding inside a parent node.
const exprLines = (expr: Expr): string[] => {
  switch (expr.kind) {
    case 'literal':
      switch (expr.valueType) {
        case 'Int':
          return [`${chalk.cyan('Lit')} ${chalk.yellow(String(expr.value))}`];
        case 'Float':
          return [`${chalk.cyan('Lit')} ${chalk.yellow(String(expr.value))}`];
        case 'Bool':
          return [`${chalk.cyan('Lit')} ${chalk.yellow(expr.value ? 'True' : 'False')}`];
        case 'String':
          return [`${chalk.cyan('Lit')} ${chalk.green(JSON.stringify(expr.value))}`];
        case 'None':
          return [`${chalk.cyan('Lit')} ${chalk.yellow('None')}`];
        case 'Done':
          return [`${chalk.cyan('Lit')} ${chalk.yellow('Done')}`];
      }
    case 'template': {
      const partLines = expr.parts.flatMap((part, i) =>
        branch(
          part.kind === 'text'
            ? [`${chalk.cyan('Text')} ${chalk.green(JSON.stringify(part.value))}`]
            : exprLines(part.expr),
          i === expr.parts.length - 1
        )
      );
      return [`${chalk.cyan('Template')}`, ...partLines];
    }
    case 'slot':
      return [`${chalk.cyan('Slot')} ${chalk.green(expr.name)}`];
    case 'call': {
      const argLines = expr.args.flatMap((arg, i) =>
        branch(exprLines(arg), i === expr.args.length - 1)
      );
      return [`${chalk.cyan('Call')} ${chalk.green(expr.callee)}`, ...argLines];
    }
    case 'methodCall': {
      const children = [expr.receiver, ...expr.args];
      const childLines = children.flatMap((child, i) =>
        branch(exprLines(child), i === children.length - 1)
      );
      return [`${chalk.cyan('MethodCall')} ${chalk.green('.' + expr.method)}`, ...childLines];
    }
    case 'list': {
      if (expr.elements.length === 0) {
        return [`${chalk.cyan('List')} ${chalk.dim('[]')}`];
      }
      const elementLines = expr.elements.flatMap((el, i) =>
        branch(exprLines(el), i === expr.elements.length - 1)
      );
      return [`${chalk.cyan('List')}`, ...elementLines];
    }
    case 'index': {
      const listLines = branch(exprLines(expr.list), false);
      const indexLines = branch(exprLines(expr.index), true);
      return [`${chalk.cyan('Index')}`, ...listLines, ...indexLines];
    }
    case 'unary': {
      const operand = branch(exprLines(expr.operand), true);
      return [`${chalk.cyan('Unary')} ${chalk.magenta(expr.op)}`, ...operand];
    }
    case 'binary': {
      const left = branch(exprLines(expr.left), false);
      const right = branch(exprLines(expr.right), true);
      return [`${chalk.cyan('Binary')} ${chalk.magenta(expr.op)}`, ...left, ...right];
    }
    case 'block': {
      if (expr.stmts.length === 0) {
        return [`${chalk.cyan('Block')} ${chalk.dim('(empty)')}`];
      }
      const lines = expr.stmts.flatMap((stmt, i) =>
        branch(stmtLines(stmt), i === expr.stmts.length - 1)
      );
      return [`${chalk.cyan('Block')}`, ...lines];
    }
    case 'if': {
      const condLines = branch(exprLines(expr.cond), false);
      const thenLines = branch(exprLines(expr.then), expr.else === null);
      const elseLines = expr.else !== null ? branch(exprLines(expr.else), true) : [];
      return [`${chalk.cyan('If')}`, ...condLines, ...thenLines, ...elseLines];
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

// Same line-list shape as exprLines, for the same reason: a block needs
// to embed a statement's lines and prefix them with tree-drawing chars.
const stmtLines = (stmt: Statement): string[] => {
  switch (stmt.kind) {
    case 'fix':
    case 'mut': {
      const init = branch(exprLines(stmt.init), true);
      const label = stmt.kind === 'fix' ? 'Fix' : 'Mut';
      const ann = stmt.typeAnnotation !== null ? chalk.dim(`: ${formatTypeExpr(stmt.typeAnnotation)}`) : '';
      return [`${chalk.cyan(label)} ${chalk.green(stmt.name)}${ann}`, ...init];
    }
    case 'assign': {
      const value = branch(exprLines(stmt.value), true);
      return [`${chalk.cyan('Assign')} ${chalk.green(stmt.name)}`, ...value];
    }
    case 'expr':
      return exprLines(stmt.expr);
    case 'while': {
      const cond = branch(exprLines(stmt.cond), false);
      const body = branch(exprLines(stmt.body), true);
      return [`${chalk.cyan('While')}`, ...cond, ...body];
    }
  }
};

export const formatStmt = (stmt: Statement): string => stmtLines(stmt).join('\n');

export const formatValue = (value: RuntimeValue): string => {
  switch (value.type) {
    case 'Int':
      return chalk.yellow(String(value.value));
    case 'Float':
      const floatStr = String(value.value);
      return floatStr.includes('.') ? chalk.yellow(floatStr) : chalk.yellow(floatStr + '.0');
    case 'Bool':
      return chalk.yellow(value.value ? 'True' : 'False');
    case 'String':
      return chalk.green(JSON.stringify(value.value));
    case 'List': {
      const items = value.elements.map(formatValue).join(', ');
      return chalk.yellow(`[${items}]`);
    }
    case 'None':
      return chalk.yellow('None');
    case 'Done':
      return chalk.yellow('Done');
  }
};

export const valueToString = (value: RuntimeValue): string => {
  switch (value.type) {
    case 'Int':
      return String(value.value);
    case 'Float':
      const floatStr = String(value.value);
      return floatStr.includes('.') ? floatStr : floatStr + '.0';
    case 'Bool':
      return value.value ? 'True' : 'False';
    case 'String':
      return value.value;
    case 'List': {
      const items = value.elements.map(valueToString).join(', ');
      return `[${items}]`;
    }
    case 'None':
      return 'None';
    case 'Done':
      return 'Done';
  }
};
