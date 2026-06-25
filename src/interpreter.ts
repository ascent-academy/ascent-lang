// interpreter.ts — tree-walking interpreter for the Stage 1 Ascent AST.

import type { BinaryOp, Expr, Program, Stmt, UnaryOp } from './ast.js';
import type { RawDiagnostic, Span } from './diagnostic.js';

export type RuntimeValue =
  | { type: 'int';    value: bigint }
  | { type: 'float';  value: number }
  | { type: 'bool';   value: boolean }
  | { type: 'string'; value: string };

interface Slot {
  value: RuntimeValue;
  fixed: boolean;
  nameSpan: Span;
}

export interface InterpretResult {
  diagnostics: RawDiagnostic[];
  // One entry per statement; null for fix / mut / assign (no value produced).
  results: (RuntimeValue | null)[];
}

class RuntimeError {
  constructor(readonly diag: RawDiagnostic) {}
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

function i64(value: bigint, span: Span): bigint {
  if (value < INT64_MIN || value > INT64_MAX) {
    throw new RuntimeError({ code: 'R0002', span });
  }
  return value;
}

function typeName(v: RuntimeValue): string {
  switch (v.type) {
    case 'int':    return 'Int';
    case 'float':  return 'Float';
    case 'bool':   return 'Bool';
    case 'string': return 'String';
  }
}

const OP_SYMBOL: Record<BinaryOp | UnaryOp, string> = {
  or: 'or', and: 'and',
  add: '+', sub: '-', mul: '*', divFloat: '/', divInt: 'div',
  eq: '==', neq: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=',
  neg: '-', not: 'not',
};

export class Interpreter {
  private readonly env = new Map<string, Slot>();

  run(program: Program): InterpretResult {
    const diagnostics: RawDiagnostic[] = [];
    const results: (RuntimeValue | null)[] = [];

    for (const stmt of program.stmts) {
      try {
        results.push(this.execStmt(stmt));
      } catch (e) {
        if (e instanceof RuntimeError) {
          diagnostics.push(e.diag);
          break;
        }
        throw e;
      }
    }

    return { diagnostics, results };
  }

  private execStmt(stmt: Stmt): RuntimeValue | null {
    switch (stmt.kind) {
      case 'fix': {
        if (this.env.has(stmt.name)) {
          throw new RuntimeError({ code: 'N0002', span: stmt.nameSpan, data: { name: stmt.name } });
        }
        const value = this.evalExpr(stmt.value);
        this.env.set(stmt.name, { value, fixed: true, nameSpan: stmt.nameSpan });
        return null;
      }
      case 'mut': {
        if (this.env.has(stmt.name)) {
          throw new RuntimeError({ code: 'N0002', span: stmt.nameSpan, data: { name: stmt.name } });
        }
        const value = this.evalExpr(stmt.value);
        this.env.set(stmt.name, { value, fixed: false, nameSpan: stmt.nameSpan });
        return null;
      }
      case 'assign': {
        const slot = this.env.get(stmt.name);
        if (!slot) {
          throw new RuntimeError({ code: 'N0004', span: stmt.nameSpan, data: { name: stmt.name } });
        }
        if (slot.fixed) {
          throw new RuntimeError({ code: 'N0003', span: stmt.nameSpan, data: { name: stmt.name } });
        }
        slot.value = this.evalExpr(stmt.value);
        return null;
      }
      case 'expr':
        return this.evalExpr(stmt.expr);
    }
  }

  private evalExpr(expr: Expr): RuntimeValue {
    switch (expr.kind) {
      case 'int':    return { type: 'int',    value: expr.value };
      case 'float':  return { type: 'float',  value: expr.value };
      case 'bool':   return { type: 'bool',   value: expr.value };
      case 'string': return { type: 'string', value: expr.value };

      case 'name': {
        const slot = this.env.get(expr.name);
        if (!slot) {
          throw new RuntimeError({ code: 'N0001', span: expr.span, data: { name: expr.name } });
        }
        return slot.value;
      }

      case 'unary':
        return this.evalUnary(expr.op, this.evalExpr(expr.operand), expr.operand.span);

      case 'binary':
        return this.evalBinary(expr);
    }
  }

  private evalUnary(op: UnaryOp, v: RuntimeValue, span: Span): RuntimeValue {
    switch (op) {
      case 'not':
        if (v.type !== 'bool') {
          throw new RuntimeError({ code: 'T0004', span, data: { type: typeName(v) } });
        }
        return { type: 'bool', value: !v.value };

      case 'neg':
        if (v.type === 'int')   return { type: 'int',   value: i64(-v.value, span) };
        if (v.type === 'float') return { type: 'float', value: -v.value };
        throw new RuntimeError({ code: 'T0005', span, data: { op: OP_SYMBOL.neg, type: typeName(v) } });
    }
  }

  private evalBinary(expr: Extract<Expr, { kind: 'binary' }>): RuntimeValue {
    const { op, left: lx, right: rx, span } = expr;

    if (op === 'and' || op === 'or') {
      const lv = this.evalExpr(lx);
      if (lv.type !== 'bool') {
        throw new RuntimeError({ code: 'T0004', span: lx.span, data: { type: typeName(lv) } });
      }
      if (op === 'and' && !lv.value) return { type: 'bool', value: false };
      if (op === 'or'  &&  lv.value) return { type: 'bool', value: true  };
      const rv = this.evalExpr(rx);
      if (rv.type !== 'bool') {
        throw new RuntimeError({ code: 'T0004', span: rx.span, data: { type: typeName(rv) } });
      }
      return { type: 'bool', value: rv.value };
    }

    const lv = this.evalExpr(lx);
    const rv = this.evalExpr(rx);

    switch (op) {
      case 'add': case 'sub': case 'mul': case 'divFloat': case 'divInt':
        return this.evalArith(op, lv, lx.span, rv, rx.span, span);
      case 'eq':  return { type: 'bool', value:  this.equal(lv, rv, span) };
      case 'neq': return { type: 'bool', value: !this.equal(lv, rv, span) };
      case 'lt': case 'lte': case 'gt': case 'gte':
        return this.evalCmp(op, lv, lx.span, rv, rx.span);
    }
  }

  private evalArith(
    op: 'add' | 'sub' | 'mul' | 'divFloat' | 'divInt',
    lv: RuntimeValue, ls: Span,
    rv: RuntimeValue, rs: Span,
    span: Span,
  ): RuntimeValue {
    if (lv.type !== 'int' && lv.type !== 'float') {
      throw new RuntimeError({ code: 'T0005', span: ls, data: { op: OP_SYMBOL[op], type: typeName(lv) } });
    }
    if (rv.type !== 'int' && rv.type !== 'float') {
      throw new RuntimeError({ code: 'T0005', span: rs, data: { op: OP_SYMBOL[op], type: typeName(rv) } });
    }

    if (op === 'divInt') {
      if (lv.type !== 'int') throw new RuntimeError({ code: 'T0003', span: ls, data: { type: typeName(lv) } });
      if (rv.type !== 'int') throw new RuntimeError({ code: 'T0003', span: rs, data: { type: typeName(rv) } });
      if (rv.value === 0n)   throw new RuntimeError({ code: 'R0001', span });
      return { type: 'int', value: lv.value / rv.value };
    }

    // If either operand is float, promote both and compute in floating point.
    if (op === 'divFloat' || lv.type === 'float' || rv.type === 'float') {
      const l = lv.type === 'int' ? Number(lv.value) : lv.value;
      const r = rv.type === 'int' ? Number(rv.value) : rv.value;
      if (op === 'divFloat' && r === 0) throw new RuntimeError({ code: 'R0001', span });
      switch (op) {
        case 'add':      return { type: 'float', value: l + r };
        case 'sub':      return { type: 'float', value: l - r };
        case 'mul':      return { type: 'float', value: l * r };
        case 'divFloat': return { type: 'float', value: l / r };
        default:         throw new Error('unreachable');
      }
    }

    // Both operands are Int.
    const l = (lv as Extract<RuntimeValue, { type: 'int' }>).value;
    const r = (rv as Extract<RuntimeValue, { type: 'int' }>).value;
    switch (op) {
      case 'add': return { type: 'int', value: i64(l + r, span) };
      case 'sub': return { type: 'int', value: i64(l - r, span) };
      case 'mul': return { type: 'int', value: i64(l * r, span) };
      default:    throw new Error('unreachable');
    }
  }

  private evalCmp(
    op: 'lt' | 'lte' | 'gt' | 'gte',
    lv: RuntimeValue, ls: Span,
    rv: RuntimeValue, rs: Span,
  ): RuntimeValue {
    if (lv.type !== 'int' && lv.type !== 'float') {
      throw new RuntimeError({ code: 'T0005', span: ls, data: { op: OP_SYMBOL[op], type: typeName(lv) } });
    }
    if (rv.type !== 'int' && rv.type !== 'float') {
      throw new RuntimeError({ code: 'T0005', span: rs, data: { op: OP_SYMBOL[op], type: typeName(rv) } });
    }
    const l = lv.type === 'int' ? Number(lv.value) : lv.value;
    const r = rv.type === 'int' ? Number(rv.value) : rv.value;
    const result = op === 'lt' ? l < r : op === 'lte' ? l <= r : op === 'gt' ? l > r : l >= r;
    return { type: 'bool', value: result };
  }

  private equal(lv: RuntimeValue, rv: RuntimeValue, span: Span): boolean {
    // Numeric: Int → Float promotion
    if ((lv.type === 'int' || lv.type === 'float') && (rv.type === 'int' || rv.type === 'float')) {
      const l = lv.type === 'int' ? Number(lv.value) : lv.value;
      const r = rv.type === 'int' ? Number(rv.value) : rv.value;
      return l === r;
    }
    if (lv.type !== rv.type) {
      throw new RuntimeError({ code: 'T0005', span, data: { op: OP_SYMBOL.eq, leftType: typeName(lv), rightType: typeName(rv) } });
    }
    if (lv.type === 'bool'   && rv.type === 'bool')   return lv.value === rv.value;
    if (lv.type === 'string' && rv.type === 'string') return lv.value === rv.value;
    throw new Error('unreachable');
  }
}
