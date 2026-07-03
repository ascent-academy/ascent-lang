import type { Span } from './errors/marker.js';
import type { UnaryOp, BinaryOp, ArgDef, TypeExpr } from './ast.js';
import type { Type } from './types.js';

// Every typed expression carries `ty`: the Type inferred by the type checker.
// The `ty` field is the semantic type; `type` on literal nodes remains the
// literal kind discriminator (Int/Float/Bool/String/None/Done), exactly as in
// the untyped AST, to avoid a field-name collision.
export type TypedLiteral = (
  | { kind: 'literal'; type: 'Int';    value: bigint;  ty: Type; span: Span }
  | { kind: 'literal'; type: 'Float';  value: number;  ty: Type; span: Span }
  | { kind: 'literal'; type: 'Bool';   value: boolean; ty: Type; span: Span }
  | { kind: 'literal'; type: 'String'; value: string;  ty: Type; span: Span }
  | { kind: 'literal'; type: 'None';                   ty: Type; span: Span }
  | { kind: 'literal'; type: 'Done';                   ty: Type; span: Span }
);

export type TypedExpr = (
  | TypedLiteral
  | { kind: 'slot';       name: string; ty: Type; span: Span }
  | { kind: 'call';       callee: string; args: TypedExpr[]; ty: Type; span: Span }
  | { kind: 'methodCall'; receiver: TypedExpr; method: string; args: TypedExpr[]; ty: Type; span: Span }
  | { kind: 'list';       elements: TypedExpr[]; ty: Type; span: Span }
  | { kind: 'index';      list: TypedExpr; index: TypedExpr; ty: Type; span: Span }
  | { kind: 'unary';      op: UnaryOp; operand: TypedExpr; ty: Type; span: Span }
  | { kind: 'binary';     op: BinaryOp; left: TypedExpr; right: TypedExpr; ty: Type; span: Span }
  | TypedBlock
  | TypedIf
);

// ty is the type the block yields: the type of the last expr-statement,
// or Done when the block is empty or ends with a non-expr statement.
export type TypedBlock = {
  kind: 'block';
  stmts: TypedStatement[];
  ty: Type;
  span: Span;
};

export type TypedIf = {
  kind: 'if';
  cond: TypedExpr;
  then: TypedBlock;
  else: TypedBlock | TypedIf | null;
  ty: Type;
  span: Span;
};

// slotType is the definitive declared type of the slot — the annotation type
// when provided, otherwise the inferred init type. The interpreter uses it to
// coerce the init value (e.g. Int → Float when the annotation says Float).
export type TypedStatement = (
  | { kind: 'fix';    name: string; typeAnnotation: TypeExpr | null; slotType: Type; init: TypedExpr; span: Span }
  | { kind: 'mut';    name: string; typeAnnotation: TypeExpr | null; slotType: Type; init: TypedExpr; span: Span }
  | { kind: 'assign'; name: string; slotType: Type; value: TypedExpr; span: Span }
  | { kind: 'expr';   expr: TypedExpr; span: Span }
  | { kind: 'while';  cond: TypedExpr; body: TypedBlock; span: Span }
);

export type TypedProgram = {
  args: ArgDef[];
  stmts: TypedStatement[];
};
