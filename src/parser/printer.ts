import chalk from 'chalk';
import type { Expr, Statement, TypeExpr, Pattern } from './ast.js';
import type { RuntimeValue } from '../interpreter.js';
import { typeToString, functionType } from '../types/types.js';

// How a 'match' arm's pattern shows in the AST dump — the constant it compares
// against, a variant tag (with its bound fields), or 'else'. Shared by both
// printers (this one and typed-printer).
export const patternLabel = (pattern: Pattern): string => {
  switch (pattern.kind) {
    case 'elsePattern': return 'else';
    case 'nonePattern': return 'None';
    case 'bindingPattern': return pattern.name;
    case 'litPattern':
      switch (pattern.valueType) {
        case 'Int': return String(pattern.value);
        case 'Float': return String(pattern.value);
        case 'Bool': return pattern.value ? 'True' : 'False';
        case 'String': return JSON.stringify(pattern.value);
      }
    case 'variantPattern': {
      if (pattern.fields.length === 0) return pattern.tag;
      const fields = pattern.fields.map(f => f.field === f.bind ? f.field : `${f.field}: ${f.bind}`).join(', ');
      return `${pattern.tag}{ ${fields} }`;
    }
  }
};

const formatTypeExpr = (te: TypeExpr): string => {
  switch (te.kind) {
    case 'TypeName': return te.name;
    case 'ListType': return `List<${formatTypeExpr(te.elem)}>`;
    case 'OptionalType': return `${formatTypeExpr(te.elem)}?`;
    case 'ResultType': return `${formatTypeExpr(te.ok)} orfail ${formatTypeExpr(te.err)}`;
    case 'FnType': return `Fn(${te.params.map(formatTypeExpr).join(', ')}) -> ${formatTypeExpr(te.result)}`;
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
    case 'apply': {
      const children = [expr.callee, ...expr.args];
      const childLines = children.flatMap((child, i) =>
        branch(exprLines(child), i === children.length - 1)
      );
      return [`${chalk.cyan('Apply')}`, ...childLines];
    }
    case 'fn': {
      const sig = `(${expr.params.map(p => `${p.name}: ${formatTypeExpr(p.type)}`).join(', ')}): ${formatTypeExpr(expr.returnType)}`;
      const bodyLines = branch(exprLines(expr.body), true);
      return [`${chalk.cyan('Fn')} ${chalk.dim(sig)}`, ...bodyLines];
    }
    case 'return': {
      if (expr.value === null) return [`${chalk.cyan('Return')}`];
      return [`${chalk.cyan('Return')}`, ...branch(exprLines(expr.value), true)];
    }
    case 'methodCall': {
      const children = [expr.receiver, ...expr.args];
      const childLines = children.flatMap((child, i) =>
        branch(exprLines(child), i === children.length - 1)
      );
      return [`${chalk.cyan('MethodCall')} ${chalk.green('.' + expr.method)}`, ...childLines];
    }
    case 'construct': {
      const fieldLines = expr.fields.flatMap((f, i) =>
        branch([`${chalk.green(f.name)}:`, ...branch(exprLines(f.value), true)], i === expr.fields.length - 1)
      );
      return [`${chalk.cyan('Construct')} ${chalk.green(expr.typeName)}`, ...fieldLines];
    }
    case 'with': {
      const baseLines = branch(exprLines(expr.base), false);
      const updateLines = expr.updates.flatMap((u, i) => {
        const last = i === expr.updates.length - 1;
        if (u.kind === 'field') {
          return branch([`${chalk.green(u.field)} ${chalk.dim('=')}`, ...branch(exprLines(u.value), true)], last);
        }
        const indexLines = branch(exprLines(u.index), false);
        return branch([`${chalk.dim('[index] =')}`, ...indexLines, ...branch(exprLines(u.value), true)], last);
      });
      return [`${chalk.cyan('With')}`, ...baseLines, ...updateLines];
    }
    case 'fieldAccess': {
      const receiverLines = branch(exprLines(expr.receiver), true);
      return [`${chalk.cyan('FieldAccess')} ${chalk.green('.' + expr.field)}`, ...receiverLines];
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
    case 'range': {
      const loLines = branch(exprLines(expr.lo), false);
      const hiLines = branch(exprLines(expr.hi), true);
      return [`${chalk.cyan('Range')}`, ...loLines, ...hiLines];
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
    case 'coalesce': {
      const left = branch(exprLines(expr.left), false);
      const right = branch(exprLines(expr.right), true);
      return [`${chalk.cyan('Coalesce')} ${chalk.magenta('??')}`, ...left, ...right];
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
    case 'match': {
      const subjectLines = branch(exprLines(expr.subject), expr.arms.length === 0);
      const armLines = expr.arms.flatMap((arm, i) =>
        branch(
          [`${chalk.magenta(patternLabel(arm.pattern))} ${chalk.dim('->')}`, ...branch(exprLines(arm.body), true)],
          i === expr.arms.length - 1
        )
      );
      return [`${chalk.cyan('Match')}`, ...subjectLines, ...armLines];
    }
    case 'try': {
      const subjectLines = branch(exprLines(expr.subject), expr.elseClause === null);
      if (expr.elseClause === null) return [`${chalk.cyan('Try')}`, ...subjectLines];
      const bind = expr.elseClause.binding !== null ? ` ${chalk.green(expr.elseClause.binding.name)}` : '';
      const elseLines = branch([`${chalk.magenta('else')}${bind} ${chalk.dim('->')}`, ...branch(exprLines(expr.elseClause.body), true)], true);
      return [`${chalk.cyan('Try')}`, ...subjectLines, ...elseLines];
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
      const target = stmt.target.kind === 'name'
        ? stmt.target.name
        : `${stmt.target.typeName}{ ${stmt.target.fields.map(f => f.field === f.bind ? f.field : `${f.field}: ${f.bind}`).join(', ')} }`;
      return [`${chalk.cyan(label)} ${chalk.green(target)}${ann}`, ...init];
    }
    case 'assign': {
      const value = branch(exprLines(stmt.value), true);
      return [`${chalk.cyan('Assign')} ${chalk.green(stmt.name)}`, ...value];
    }
    case 'typeDecl': {
      const variantLines = stmt.variants.flatMap((v, i) => {
        const fieldLines = v.fields.flatMap((f, j) =>
          branch([`${chalk.green(f.name)}${chalk.dim(': ' + formatTypeExpr(f.type))}`], j === v.fields.length - 1)
        );
        return branch([`${chalk.cyan('Variant')} ${chalk.green(v.tag)}`, ...fieldLines], i === stmt.variants.length - 1);
      });
      return [`${chalk.cyan('Type')} ${chalk.green(stmt.name)}`, ...variantLines];
    }
    case 'expr':
      return exprLines(stmt.expr);
    case 'void':
      return [`${chalk.cyan('Void')}`, ...branch(exprLines(stmt.expr), true)];
    case 'while': {
      const cond = branch(exprLines(stmt.cond), false);
      const body = branch(exprLines(stmt.body), true);
      return [`${chalk.cyan('While')}`, ...cond, ...body];
    }
    case 'for': {
      const iterable = branch(exprLines(stmt.iterable), false);
      const body = branch(exprLines(stmt.body), true);
      const target = stmt.target.kind === 'name'
        ? stmt.target.name
        : `${stmt.target.typeName}{ ${stmt.target.fields.map(f => f.field === f.bind ? f.field : `${f.field}: ${f.bind}`).join(', ')} }`;
      return [`${chalk.cyan('For')} ${chalk.green(target)}`, ...iterable, ...body];
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
    case 'Range':
      return chalk.yellow(`${value.lo}..${value.hi}`);
    case 'Record': {
      // A zero-field variant (an enum case) shows as its bare name — the same
      // braceless spelling it's written with (whitepaper §6).
      if (value.fields.size === 0) return chalk.cyan(value.name);
      const fields = Array.from(value.fields, ([name, v]) => `${name}: ${formatValue(v)}`).join(', ');
      return `${chalk.cyan(value.name)}{ ${fields} }`;
    }
    // A function has no data to show — render its type (whitepaper §5: functions
    // aren't Display, so this only surfaces in a value/AST dump, never in print
    // or interpolation).
    case 'Function':
      return chalk.magenta(typeToString(functionType(value.params.map(p => p.type), value.result)));
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
    case 'Range':
      return `${value.lo}..${value.hi}`;
    case 'Record': {
      if (value.fields.size === 0) return value.name;
      const fields = Array.from(value.fields, ([name, v]) => `${name}: ${valueToString(v)}`).join(', ');
      return `${value.name}{ ${fields} }`;
    }
    case 'Function':
      return typeToString(functionType(value.params.map(p => p.type), value.result));
    case 'None':
      return 'None';
    case 'Done':
      return 'Done';
  }
};
