import type { Span } from './errors/marker.js';

// TypeExpr is the AST node for a type written in source code.
// It carries span information so the type checker can point at it in errors.
export type TypeExpr =
  | { kind: 'TypeName'; name: 'Int' | 'Float' | 'Bool' | 'String'; span: Span }
  | { kind: 'ListType'; elem: TypeExpr; span: Span };

export type Literal = (
  | { kind: 'literal'; type: 'Int'; value: bigint; span: Span }
  | { kind: 'literal'; type: 'Float'; value: number; span: Span }
  | { kind: 'literal'; type: 'Bool'; value: boolean; span: Span }
  | { kind: 'literal'; type: 'String'; value: string; span: Span }
  | { kind: 'literal'; type: 'None'; span: Span }
  | { kind: 'literal'; type: 'Done'; span: Span }
);

export type UnaryOp = '-';
export type ArithmeticOp = '+' | '-' | '*' | '/' | 'div' | 'mod';
export type ComparisonOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type BinaryOp = ArithmeticOp | ComparisonOp;

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
  | { kind: 'call'; callee: string; args: Expr[]; span: Span }
  | { kind: 'methodCall'; receiver: Expr; method: string; args: Expr[]; span: Span }
  | { kind: 'list'; elements: Expr[]; span: Span }
  | { kind: 'index'; list: Expr; index: Expr; span: Span }
  | { kind: 'unary'; op: UnaryOp; operand: Expr; span: Span }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; span: Span }
  | Block
  | If
);

// Unlike 'if', 'while' is a statement, not an expression — a loop has
// no single meaningful result (zero iterations has no last value to
// give), so it always yields Done rather than forcing a fake one.
export type Statement = (
  | { kind: 'fix'; name: string; typeAnnotation: TypeExpr | null; init: Expr; span: Span }
  | { kind: 'mut'; name: string; typeAnnotation: TypeExpr | null; init: Expr; span: Span }
  | { kind: 'assign'; name: string; value: Expr; span: Span }
  | { kind: 'expr'; expr: Expr; span: Span }
  | { kind: 'while'; cond: Expr; body: Block; span: Span }
);

export type ArgType = 'Int' | 'Float' | 'Bool' | 'String';
export type ArgDef = { name: string; type: ArgType };

export type Program = { args: ArgDef[]; stmts: Statement[] };
