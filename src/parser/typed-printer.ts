import chalk from 'chalk';
import type { TypedExpr, TypedStatement } from './typed-ast.js';
import { typeToString } from '../types/types.js';
import { branch, patternLabel } from './printer.js';

// Appends the inferred type as a dim annotation on a node label.
const ty = (t: ReturnType<typeof typeToString>): string => chalk.dim(`: ${t}`);

const typedExprLines = (expr: TypedExpr): string[] => {
  const t = ty(typeToString(expr.type));

  switch (expr.kind) {
    case 'literal':
      switch (expr.valueType) {
        case 'Int': return [`${chalk.cyan('Lit')} ${chalk.yellow(String(expr.value))}${t}`];
        case 'Float': return [`${chalk.cyan('Lit')} ${chalk.yellow(String(expr.value))}${t}`];
        case 'Bool': return [`${chalk.cyan('Lit')} ${chalk.yellow(expr.value ? 'True' : 'False')}${t}`];
        case 'String': return [`${chalk.cyan('Lit')} ${chalk.green(JSON.stringify(expr.value))}${t}`];
        case 'None': return [`${chalk.cyan('Lit')} ${chalk.yellow('None')}${t}`];
        case 'Done': return [`${chalk.cyan('Lit')} ${chalk.yellow('Done')}${t}`];
      }
    case 'template': {
      const partLines = expr.parts.flatMap((part, i) =>
        branch(
          part.kind === 'text'
            ? [`${chalk.cyan('Text')} ${chalk.green(JSON.stringify(part.value))}`]
            : typedExprLines(part.expr),
          i === expr.parts.length - 1
        )
      );
      return [`${chalk.cyan('Template')}${t}`, ...partLines];
    }
    case 'slot':
      return [`${chalk.cyan('Slot')} ${chalk.green(expr.name)}${t}`];
    case 'call': {
      const argLines = expr.args.flatMap((arg, i) =>
        branch(typedExprLines(arg), i === expr.args.length - 1)
      );
      return [`${chalk.cyan('Call')} ${chalk.green(expr.callee)}${t}`, ...argLines];
    }
    case 'apply': {
      const children = [expr.callee, ...expr.args];
      const childLines = children.flatMap((child, i) =>
        branch(typedExprLines(child), i === children.length - 1)
      );
      return [`${chalk.cyan('Apply')}${t}`, ...childLines];
    }
    case 'fn': {
      const sig = `(${expr.params.map(p => `${p.name}: ${typeToString(p.type)}`).join(', ')})`;
      const bodyLines = branch(typedExprLines(expr.body), true);
      return [`${chalk.cyan('Fn')} ${chalk.dim(sig)}${t}`, ...bodyLines];
    }
    case 'return': {
      if (expr.value === null) return [`${chalk.cyan('Return')}${t}`];
      return [`${chalk.cyan('Return')}${t}`, ...branch(typedExprLines(expr.value), true)];
    }
    case 'methodCall': {
      const children = [expr.receiver, ...expr.args];
      const childLines = children.flatMap((child, i) =>
        branch(typedExprLines(child), i === children.length - 1)
      );
      return [`${chalk.cyan('MethodCall')} ${chalk.green('.' + expr.method)}${t}`, ...childLines];
    }
    case 'construct': {
      const fieldLines = expr.fields.flatMap((f, i) =>
        branch([`${chalk.green(f.name)}:`, ...branch(typedExprLines(f.value), true)], i === expr.fields.length - 1)
      );
      return [`${chalk.cyan('Construct')} ${chalk.green(expr.typeName)}${t}`, ...fieldLines];
    }
    case 'fieldAccess': {
      const receiverLines = branch(typedExprLines(expr.receiver), true);
      return [`${chalk.cyan('FieldAccess')} ${chalk.green('.' + expr.field)}${t}`, ...receiverLines];
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
    case 'range': {
      const loLines = branch(typedExprLines(expr.lo), false);
      const hiLines = branch(typedExprLines(expr.hi), true);
      return [`${chalk.cyan('Range')}${t}`, ...loLines, ...hiLines];
    }
    case 'index': {
      const listLines = branch(typedExprLines(expr.list), false);
      const indexLines = branch(typedExprLines(expr.index), true);
      return [`${chalk.cyan('Index')}${t}`, ...listLines, ...indexLines];
    }
    case 'unary': {
      const operandLines = branch(typedExprLines(expr.operand), true);
      return [`${chalk.cyan('Unary')} ${chalk.magenta(expr.op)}${t}`, ...operandLines];
    }
    case 'binary': {
      const leftLines = branch(typedExprLines(expr.left), false);
      const rightLines = branch(typedExprLines(expr.right), true);
      return [`${chalk.cyan('Binary')} ${chalk.magenta(expr.op)}${t}`, ...leftLines, ...rightLines];
    }
    case 'coalesce': {
      const leftLines = branch(typedExprLines(expr.left), false);
      const rightLines = branch(typedExprLines(expr.right), true);
      return [`${chalk.cyan('Coalesce')} ${chalk.magenta('??')}${t}`, ...leftLines, ...rightLines];
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
    case 'match': {
      const subjectLines = branch(typedExprLines(expr.subject), expr.arms.length === 0);
      const armLines = expr.arms.flatMap((arm, i) =>
        branch(
          [`${chalk.magenta(patternLabel(arm.pattern))} ${chalk.dim('->')}`, ...branch(typedExprLines(arm.body), true)],
          i === expr.arms.length - 1
        )
      );
      return [`${chalk.cyan('Match')}${t}`, ...subjectLines, ...armLines];
    }
    case 'try': {
      const subjectLines = branch(typedExprLines(expr.subject), expr.elseClause === null);
      if (expr.elseClause === null) return [`${chalk.cyan('Try')}${t}`, ...subjectLines];
      const bind = expr.elseClause.binding !== null ? ` ${chalk.green(expr.elseClause.binding)}` : '';
      const elseLines = branch([`${chalk.magenta('else')}${bind} ${chalk.dim('->')}`, ...branch(typedExprLines(expr.elseClause.body), true)], true);
      return [`${chalk.cyan('Try')}${t}`, ...subjectLines, ...elseLines];
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
      const target = stmt.target.kind === 'name'
        ? stmt.target.name
        : `${stmt.target.typeName}{ ${stmt.target.fields.map(f => f.field === f.bind ? f.field : `${f.field}: ${f.bind}`).join(', ')} }`;
      return [`${chalk.cyan(label)} ${chalk.green(target)}${slotTy}`, ...initLines];
    }
    case 'assign': {
      const slotTy = ty(typeToString(stmt.slotType));
      const valueLines = branch(typedExprLines(stmt.value), true);
      return [`${chalk.cyan('Assign')} ${chalk.green(stmt.name)}${slotTy}`, ...valueLines];
    }
    case 'typeDecl': {
      const variantLines = stmt.variants.flatMap((v, i) => {
        const fieldLines = v.fields.flatMap((f, j) =>
          branch([`${chalk.green(f.name)}${ty(typeToString(f.type))}`], j === v.fields.length - 1)
        );
        return branch([`${chalk.cyan('Variant')} ${chalk.green(v.tag)}`, ...fieldLines], i === stmt.variants.length - 1);
      });
      return [`${chalk.cyan('Type')} ${chalk.green(stmt.name)}`, ...variantLines];
    }
    case 'expr':
      return typedExprLines(stmt.expr);
    case 'void':
      return [`${chalk.cyan('Void')}`, ...branch(typedExprLines(stmt.expr), true)];
    case 'while': {
      const condLines = branch(typedExprLines(stmt.cond), false);
      const bodyLines = branch(typedExprLines(stmt.body), true);
      return [`${chalk.cyan('While')}`, ...condLines, ...bodyLines];
    }
    case 'for': {
      const target = stmt.target.kind === 'name'
        ? stmt.target.name
        : `${stmt.target.typeName}{ ${stmt.target.fields.map(f => f.field === f.bind ? f.field : `${f.field}: ${f.bind}`).join(', ')} }`;
      const nameLabel = `${chalk.green(target)}${ty(typeToString(stmt.elemType))}`;
      const iterableLines = branch(typedExprLines(stmt.iterable), false);
      const bodyLines = branch(typedExprLines(stmt.body), true);
      return [`${chalk.cyan('For')} ${nameLabel}`, ...iterableLines, ...bodyLines];
    }
  }
};

export const formatTypedStmt = (stmt: TypedStatement): string =>
  typedStmtLines(stmt).join('\n');
