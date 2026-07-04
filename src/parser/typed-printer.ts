import chalk from 'chalk';
import type { TypedExpr, TypedStatement } from './typed-ast.js';
import { typeToString } from './types.js';
import { branch } from './printer.js';

// Appends the inferred type as a dim annotation on a node label.
const ty = (t: ReturnType<typeof typeToString>): string => chalk.dim(`: ${t}`);

const typedExprLines = (expr: TypedExpr): string[] => {
  const t = ty(typeToString(expr.ty));

  switch (expr.kind) {
    case 'literal':
      switch (expr.type) {
        case 'Int':    return [`${chalk.cyan('Int')} ${chalk.yellow(String(expr.value))}${t}`];
        case 'Float':  return [`${chalk.cyan('Float')} ${chalk.yellow(String(expr.value))}${t}`];
        case 'Bool':   return [`${chalk.cyan('Bool')} ${chalk.yellow(expr.value ? 'True' : 'False')}${t}`];
        case 'String': return [`${chalk.cyan('String')} ${chalk.green(JSON.stringify(expr.value))}${t}`];
        case 'None':   return [`${chalk.cyan('None')}${t}`];
        case 'Done':   return [`${chalk.cyan('Done')}${t}`];
      }
    case 'slot':
      return [`${chalk.cyan('Slot')} ${chalk.green(expr.name)}${t}`];
    case 'call': {
      const argLines = expr.args.flatMap((arg, i) =>
        branch(typedExprLines(arg), i === expr.args.length - 1)
      );
      return [`${chalk.cyan('Call')} ${chalk.green(expr.callee)}${t}`, ...argLines];
    }
    case 'methodCall': {
      const children = [expr.receiver, ...expr.args];
      const childLines = children.flatMap((child, i) =>
        branch(typedExprLines(child), i === children.length - 1)
      );
      return [`${chalk.cyan('MethodCall')} ${chalk.green('.' + expr.method)}${t}`, ...childLines];
    }
    case 'list': {
      if (expr.elements.length === 0) {
        return [`${chalk.cyan('List')} ${chalk.dim('[]')}${t}`];
      }
      const elementLines = expr.elements.flatMap((el, i) =>
        branch(typedExprLines(el), i === expr.elements.length - 1)
      );
      return [`${chalk.cyan('List')}${t}`, ...elementLines];
    }
    case 'index': {
      const listLines  = branch(typedExprLines(expr.list),  false);
      const indexLines = branch(typedExprLines(expr.index), true);
      return [`${chalk.cyan('Index')}${t}`, ...listLines, ...indexLines];
    }
    case 'unary': {
      const operandLines = branch(typedExprLines(expr.operand), true);
      return [`${chalk.cyan('Unary')} ${chalk.magenta(expr.op)}${t}`, ...operandLines];
    }
    case 'binary': {
      const leftLines  = branch(typedExprLines(expr.left),  false);
      const rightLines = branch(typedExprLines(expr.right), true);
      return [`${chalk.cyan('Binary')} ${chalk.magenta(expr.op)}${t}`, ...leftLines, ...rightLines];
    }
    case 'block': {
      if (expr.stmts.length === 0) {
        return [`${chalk.cyan('Block')} ${chalk.dim('(empty)')}${t}`];
      }
      const stmtLines = expr.stmts.flatMap((stmt, i) =>
        branch(typedStmtLines(stmt), i === expr.stmts.length - 1)
      );
      return [`${chalk.cyan('Block')}${t}`, ...stmtLines];
    }
    case 'if': {
      const condLines = branch(typedExprLines(expr.cond), false);
      const thenLines = branch(typedExprLines(expr.then), expr.else === null);
      const elseLines = expr.else !== null
        ? branch(typedExprLines(expr.else), true)
        : [];
      return [`${chalk.cyan('If')}${t}`, ...condLines, ...thenLines, ...elseLines];
    }
  }
};

const typedStmtLines = (stmt: TypedStatement): string[] => {
  switch (stmt.kind) {
    case 'fix':
    case 'mut': {
      const label = stmt.kind === 'fix' ? 'Fix' : 'Mut';
      const slotTy = ty(typeToString(stmt.slotType));
      const initLines = branch(typedExprLines(stmt.init), true);
      return [`${chalk.cyan(label)} ${chalk.green(stmt.name)}${slotTy}`, ...initLines];
    }
    case 'assign': {
      const slotTy = ty(typeToString(stmt.slotType));
      const valueLines = branch(typedExprLines(stmt.value), true);
      return [`${chalk.cyan('Assign')} ${chalk.green(stmt.name)}${slotTy}`, ...valueLines];
    }
    case 'expr':
      return typedExprLines(stmt.expr);
    case 'while': {
      const condLines = branch(typedExprLines(stmt.cond), false);
      const bodyLines = branch(typedExprLines(stmt.body), true);
      return [`${chalk.cyan('While')}`, ...condLines, ...bodyLines];
    }
  }
};

export const formatTypedStmt = (stmt: TypedStatement): string =>
  typedStmtLines(stmt).join('\n');
