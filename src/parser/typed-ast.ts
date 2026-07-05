import type { Span } from '../lexer/token.js';
import type { UnaryOp, BinaryOp, ProgramArg, TypeExpr } from './ast.js';
import type { AscentType } from '../types/types.js';

// Every typed expression carries `type`: the Type inferred by the type
// checker. On literal nodes, `valueType` remains the literal kind
// discriminator (Int/Float/Bool/String/None/Done), exactly as in the
// untyped AST, to avoid a field-name collision with `type`.
export type TypedLiteral = (
  | { kind: 'literal'; valueType: 'Int'; value: bigint; type: AscentType; span: Span }
  | { kind: 'literal'; valueType: 'Float'; value: number; type: AscentType; span: Span }
  | { kind: 'literal'; valueType: 'Bool'; value: boolean; type: AscentType; span: Span }
  | { kind: 'literal'; valueType: 'String'; value: string; type: AscentType; span: Span }
  | { kind: 'literal'; valueType: 'None'; type: AscentType; span: Span }
  | { kind: 'literal'; valueType: 'Done'; type: AscentType; span: Span }
);

export type TypedExpr = (
  | TypedLiteral
  | { kind: 'slot'; name: string; type: AscentType; span: Span }
  | { kind: 'call'; callee: string; args: TypedExpr[]; type: AscentType; span: Span }
  | { kind: 'methodCall'; receiver: TypedExpr; method: string; args: TypedExpr[]; type: AscentType; span: Span }
  | { kind: 'list'; elements: TypedExpr[]; type: AscentType; span: Span }
  | { kind: 'index'; list: TypedExpr; index: TypedExpr; type: AscentType; span: Span }
  | { kind: 'unary'; op: UnaryOp; operand: TypedExpr; type: AscentType; span: Span }
  | { kind: 'binary'; op: BinaryOp; left: TypedExpr; right: TypedExpr; type: AscentType; span: Span }
  | TypedBlock
  | TypedIf
);

// type is the type the block yields: the type of the last expr-statement,
// or Done when the block is empty or ends with a non-expr statement.
export type TypedBlock = {
  kind: 'block';
  stmts: TypedStatement[];
  type: AscentType;
  span: Span;
};

export type TypedIf = {
  kind: 'if';
  cond: TypedExpr;
  then: TypedBlock;
  else: TypedBlock | TypedIf | null;
  type: AscentType;
  span: Span;
};

// slotType is the definitive declared type of the slot — the annotation type
// when provided, otherwise the inferred init type. The interpreter uses it to
// coerce the init value (e.g. Int → Float when the annotation says Float).
export type TypedStatement = (
  | { kind: 'fix'; name: string; typeAnnotation: TypeExpr | null; slotType: AscentType; init: TypedExpr; span: Span }
  | { kind: 'mut'; name: string; typeAnnotation: TypeExpr | null; slotType: AscentType; init: TypedExpr; span: Span }
  | { kind: 'assign'; name: string; slotType: AscentType; value: TypedExpr; span: Span }
  | { kind: 'expr'; expr: TypedExpr; span: Span }
  | { kind: 'while'; cond: TypedExpr; body: TypedBlock; span: Span }
);

export type TypedProgram = {
  args: ProgramArg[];
  stmts: TypedStatement[];
};
