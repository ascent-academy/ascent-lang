import type { Span } from './errors/marker.js';

export type Expr = (
  | { kind: 'int'; value: bigint; span: Span }
  | { kind: 'float'; value: number; span: Span }
  | { kind: 'bool'; value: boolean; span: Span }
  | { kind: 'none'; span: Span }
  | { kind: 'done'; span: Span }
  | { kind: 'slot'; name: string; span: Span }
  | { kind: 'unary'; op: '-'; operand: Expr; span: Span }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | 'div' | 'mod'; left: Expr; right: Expr; span: Span }
);

export type Statement = (
  | { kind: 'fix'; name: string; init: Expr; span: Span }
  | { kind: 'expr'; expr: Expr; span: Span }
);

export type Program = { stmts: Statement[] };
