import type { Span } from '../lexer/token.js';

// TypeExpr is the AST node for a type written in source code.
// It carries span information so the type checker can point at it in errors.
export type TypeName = { kind: 'TypeName'; name: 'Int' | 'Float' | 'Bool' | 'String'; span: Span };
export type ListType = { kind: 'ListType'; elem: TypeExpr; span: Span };
// 'T?' — sugar for 'Optional<T>' (design.md §4). Written as a trailing '?'
// on any other TypeExpr, never as a spelled-out 'Optional<T>' name.
export type OptionalType = { kind: 'OptionalType'; elem: TypeExpr; span: Span };
export type TypeExpr = TypeName | ListType | OptionalType;

export type Literal = (
  | { kind: 'literal'; valueType: 'Int'; value: bigint; span: Span }
  | { kind: 'literal'; valueType: 'Float'; value: number; span: Span }
  | { kind: 'literal'; valueType: 'Bool'; value: boolean; span: Span }
  | { kind: 'literal'; valueType: 'String'; value: string; span: Span }
  | { kind: 'literal'; valueType: 'None'; span: Span }
  | { kind: 'literal'; valueType: 'Done'; span: Span }
);

// A String literal with at least one '${expr}' hole. A text part is the raw
// (already-unescaped) source between holes; a hole part is an arbitrary
// expression whose value the typechecker requires to already be a String
// (design.md §4/§6: no auto-stringification — call '.toString()' first). A
// String with zero holes is never a Template — it stays the plain
// { kind: 'literal', valueType: 'String' } node (see parseStringTemplate).
export type TemplatePart = { kind: 'text'; value: string } | { kind: 'hole'; expr: Expr };
export type Template = { kind: 'template'; parts: TemplatePart[]; span: Span };

export type UnaryOp = '-' | 'not';
export type ArithmeticOp = '+' | '-' | '*' | '/' | 'div' | 'mod' | '**';
export type ComparisonOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type BooleanOp = 'and' | 'or';
export type BinaryOp = ArithmeticOp | ComparisonOp | BooleanOp;

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
  | Template
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
  | { kind: 'assign'; name: string; nameSpan: Span; value: Expr; span: Span }
  | { kind: 'expr'; expr: Expr; span: Span }
  | { kind: 'while'; cond: Expr; body: Block; span: Span }
);

export type ArgType = 'Int' | 'Float' | 'Bool' | 'String';
export type ProgramArg = { name: string; type: ArgType };

export type Program = { args: ProgramArg[]; stmts: Statement[] };
