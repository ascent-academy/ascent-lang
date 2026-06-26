// ast.ts — Stage 1 AST: expressions and slot statements.
// Every node carries its source span for diagnostics.

import type { Span } from './diagnostic.js';

// Binary operators ordered by precedence group (design.md §5):
//   or < and < cmp < add/sub < mul/div
export type BinaryOp =
  | 'or' | 'and'
  | 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'
  | 'add' | 'sub'
  | 'mul' | 'divFloat' | 'divInt';

export type UnaryOp = 'neg' | 'not';

export type Expr =
  | { kind: 'int'; value: bigint; span: Span }
  | { kind: 'float'; value: number; span: Span }
  | { kind: 'bool'; value: boolean; span: Span }
  | { kind: 'string'; value: string; span: Span }
  | { kind: 'name'; name: string; span: Span }
  | { kind: 'unary'; op: UnaryOp; operand: Expr; span: Span }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; span: Span };

export type Stmt =
  | { kind: 'fix'; name: string; nameSpan: Span; value: Expr; span: Span }
  | { kind: 'mut'; name: string; nameSpan: Span; value: Expr; span: Span }
  | { kind: 'assign'; name: string; nameSpan: Span; value: Expr; span: Span }
  | { kind: 'expr'; expr: Expr; span: Span };

export interface Program {
  stmts: Stmt[];
}
