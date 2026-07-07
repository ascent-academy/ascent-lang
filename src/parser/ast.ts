import type { Span } from '../lexer/token.js';

// TypeExpr is the AST node for a type written in source code.
// It carries span information so the type checker can point at it in errors.
// `name` is any UpperCamel identifier — a built-in scalar (Int/Float/Bool/
// String) or a user-declared type (design.md §6). Which one it is, is a
// formation-time question (src/check/formation.ts), not a lexical one.
export type TypeName = { kind: 'TypeName'; name: string; span: Span };
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

// One 'field: value' entry of a record construction (design.md §6). `name`
// is the field name; `value` its initializer; the checker matches these
// against the type's declared fields (order-independent — fields bind by
// name, never by position).
export type FieldInit = { name: string; nameSpan: Span; value: Expr; span: Span };

export type Expr = (
  | Literal
  | Template
  | { kind: 'slot'; name: string; span: Span }
  | { kind: 'call'; callee: string; args: Expr[]; span: Span }
  | { kind: 'methodCall'; receiver: Expr; method: string; args: Expr[]; span: Span }
  // 'TypeName{ field: value, … }' — builds a record value of a declared type
  // (design.md §6). The only way to make one; there are no anonymous record
  // literals. `typeName` is the constructor, which for a single-variant record
  // is the type's own name.
  | { kind: 'construct'; typeName: string; typeNameSpan: Span; fields: FieldInit[]; span: Span }
  // 'e.field' — reads one field of a record (design.md §6). Legal only when
  // e's type has exactly one variant; the checker enforces that. The '.method()'
  // form stays a 'methodCall' — the parser splits on whether a '(' follows.
  | { kind: 'fieldAccess'; receiver: Expr; field: string; fieldSpan: Span; span: Span }
  | { kind: 'list'; elements: Expr[]; span: Span }
  // 'lo..hi' — a half-open Int range (design.md §4). Both bounds are
  // required; open-ended forms ('..b', 'a..') are not syntax here.
  | { kind: 'range'; lo: Expr; hi: Expr; span: Span }
  | { kind: 'index'; list: Expr; index: Expr; span: Span }
  | { kind: 'unary'; op: UnaryOp; operand: Expr; span: Span }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; span: Span }
  | Block
  | If
);

// Unlike 'if', 'while'/'for' are statements, not expressions — a loop has
// no single meaningful result (zero iterations has no last value to
// give), so they always yield Done rather than forcing a fake one.
// One 'name: Type' field of a record's type declaration (design.md §6).
// Unlike a FieldInit (which carries a value), this carries the field's
// declared *type*.
export type FieldDecl = { name: string; nameSpan: Span; type: TypeExpr; span: Span };

export type Statement = (
  | { kind: 'fix'; name: string; typeAnnotation: TypeExpr | null; init: Expr; span: Span }
  | { kind: 'mut'; name: string; typeAnnotation: TypeExpr | null; init: Expr; span: Span }
  | { kind: 'assign'; name: string; nameSpan: Span; value: Expr; span: Span }
  // 'type Name = { field: Type, … };' — declares a record type (design.md §6).
  // Sugar for the single-variant form 'type Name = Name{ … }', so the sole
  // constructor's tag is `name`. Only the bare-brace (record) form is parsed
  // for now; unions arrive later.
  | { kind: 'typeDecl'; name: string; nameSpan: Span; fields: FieldDecl[]; span: Span }
  | { kind: 'expr'; expr: Expr; span: Span }
  // 'void expr' — evaluates `expr` for its effect and discards its value, so
  // the statement itself yields Done (whitepaper §2). It's a statement, not an
  // expression operator: it only ever stands in statement position, and taking
  // a full expression is what makes 'void x + 1' discard 'x + 1', not '(void x) + 1'.
  | { kind: 'void'; expr: Expr; span: Span }
  | { kind: 'while'; cond: Expr; body: Block; span: Span }
  // 'for name in iterable { … }' — iterates the values of a List or the
  // numbers of a Range (design.md §5), binding each to `name` in the body.
  // No parens (it has no test); `name` is a fresh, per-iteration binding.
  | { kind: 'for'; name: string; nameSpan: Span; iterable: Expr; body: Block; span: Span }
);

export type ArgType = 'Int' | 'Float' | 'Bool' | 'String';
export type ProgramArg = { name: string; type: ArgType };

export type Program = { args: ProgramArg[]; stmts: Statement[] };
