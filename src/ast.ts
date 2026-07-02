import type { Span } from './errors/marker.js';

export type Literal = (
  | { kind: 'literal'; type: 'Int'; value: bigint; span: Span }
  | { kind: 'literal'; type: 'Float'; value: number; span: Span }
  | { kind: 'literal'; type: 'Bool'; value: boolean; span: Span }
  | { kind: 'literal'; type: 'None'; span: Span }
  | { kind: 'literal'; type: 'Done'; span: Span }
);

export type UnaryOp = '-';
export type BinaryOp = '+' | '-' | '*' | '/' | 'div' | 'mod';

export type Expr = (
  | Literal
  | { kind: 'slot'; name: string; span: Span }
  | { kind: 'unary'; op: UnaryOp; operand: Expr; span: Span }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; span: Span }
);

export type Statement = (
  | { kind: 'fix'; name: string; init: Expr; span: Span }
  | { kind: 'expr'; expr: Expr; span: Span }
);

export type Program = { stmts: Statement[] };
