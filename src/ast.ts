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

// A block is itself an expression — it yields the value of its last
// statement, or Done when empty (the '{}' unit value).
export type Block = { kind: 'block'; stmts: Statement[]; span: Span };

// 'else if' is sugar: the else branch is either a block or another
// If, never a separate grammar rule.
export type If = {
  kind: 'if';
  cond: Expr;
  then: Block;
  else: Block | If | null;
  span: Span;
};

export type Expr = (
  | Literal
  | { kind: 'slot'; name: string; span: Span }
  | { kind: 'unary'; op: UnaryOp; operand: Expr; span: Span }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; span: Span }
  | Block
  | If
);

export type Statement = (
  | { kind: 'fix'; name: string; init: Expr; span: Span }
  | { kind: 'expr'; expr: Expr; span: Span }
);

export type Program = { stmts: Statement[] };
