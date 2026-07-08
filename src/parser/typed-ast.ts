import type { Span } from '../lexer/token.js';
import type { UnaryOp, BinaryOp, ProgramArg, TypeExpr, Pattern } from './ast.js';
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

export type TypedTemplatePart = { kind: 'text'; value: string } | { kind: 'hole'; expr: TypedExpr };
export type TypedTemplate = { kind: 'template'; parts: TypedTemplatePart[]; type: AscentType; span: Span };

// One field of a typed record construction, stored in the type's *declaration*
// order (not source order). `declaredType` is the field's declared type — the
// interpreter coerces `value` into it (e.g. Int → Float), exactly as a fix/mut
// init coerces into its slotType.
export type TypedFieldInit = { name: string; declaredType: AscentType; value: TypedExpr };

export type TypedExpr = (
  | TypedLiteral
  | TypedTemplate
  | { kind: 'slot'; name: string; type: AscentType; span: Span }
  | { kind: 'call'; callee: string; args: TypedExpr[]; type: AscentType; span: Span }
  | { kind: 'methodCall'; receiver: TypedExpr; method: string; args: TypedExpr[]; type: AscentType; span: Span }
  | { kind: 'construct'; typeName: string; fields: TypedFieldInit[]; type: AscentType; span: Span }
  | { kind: 'fieldAccess'; receiver: TypedExpr; field: string; type: AscentType; span: Span }
  | { kind: 'list'; elements: TypedExpr[]; type: AscentType; span: Span }
  | { kind: 'range'; lo: TypedExpr; hi: TypedExpr; type: AscentType; span: Span }
  | { kind: 'index'; list: TypedExpr; index: TypedExpr; type: AscentType; span: Span }
  | { kind: 'unary'; op: UnaryOp; operand: TypedExpr; type: AscentType; span: Span }
  | { kind: 'binary'; op: BinaryOp; left: TypedExpr; right: TypedExpr; type: AscentType; span: Span }
  | TypedMatch
  | TypedBlock
  | TypedIf
);

// A pattern carries no inferred type of its own — a literal pattern's type is
// evident from its own kind — so the typed arm reuses the untyped Pattern and
// only its body becomes a TypedExpr. `type` on TypedMatch is the join of the
// reachable arms' body types (the value the whole 'match' produces).
export type TypedMatchArm = { pattern: Pattern; body: TypedExpr; span: Span };

export type TypedMatch = {
  kind: 'match';
  subject: TypedExpr;
  arms: TypedMatchArm[];
  type: AscentType;
  span: Span;
};

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
// A typed field of a record declaration — its declared type resolved to an
// AscentType. Carried for the printer / tooling; the interpreter erases types
// and needs nothing from a typeDecl at runtime.
export type TypedFieldDecl = { name: string; type: AscentType };

// A typed variant of a tagged-union declaration — its tag and its resolved
// fields. Like TypedFieldDecl, kept only for the printer / tooling; types are
// erased before the tree walk.
export type TypedVariantDecl = { tag: string; fields: TypedFieldDecl[] };

// A typed field of a record destructuring pattern — the declared field to read
// and the local it binds, with the field's resolved type (what the local slot
// holds). The interpreter reads `field`/`bind` to pull the value out of the
// record and declare it; `type` is carried for the printer / tooling.
export type TypedFieldPattern = { field: string; bind: string; type: AscentType };

// The typed twin of a BindTarget: a plain name, or a record pattern whose fields
// have been resolved against the destructured type. For a record target,
// `slotType` on the fix/mut node below is the record's own type (what the init
// is checked against); each field's local type lives here.
export type TypedBindTarget = (
  | { kind: 'name'; name: string }
  | { kind: 'record'; typeName: string; fields: TypedFieldPattern[] }
);

export type TypedStatement = (
  | { kind: 'fix'; target: TypedBindTarget; typeAnnotation: TypeExpr | null; slotType: AscentType; init: TypedExpr; span: Span }
  | { kind: 'mut'; target: TypedBindTarget; typeAnnotation: TypeExpr | null; slotType: AscentType; init: TypedExpr; span: Span }
  | { kind: 'assign'; name: string; slotType: AscentType; value: TypedExpr; span: Span }
  | { kind: 'typeDecl'; name: string; variants: TypedVariantDecl[]; span: Span }
  | { kind: 'expr'; expr: TypedExpr; span: Span }
  // 'void expr' — evaluates `expr` and discards its value; the statement yields
  // Done (whitepaper §2). No `type` field: like every non-'expr' statement, it
  // carries no value of its own.
  | { kind: 'void'; expr: TypedExpr; span: Span }
  | { kind: 'while'; cond: TypedExpr; body: TypedBlock; span: Span }
  // elemType is what each iteration produces: a List's element type, or Int for
  // a Range. For a name target it's the loop variable's type; for a record
  // target it's the (single-variant record) type each element destructures as.
  | { kind: 'for'; target: TypedBindTarget; elemType: AscentType; iterable: TypedExpr; body: TypedBlock; span: Span }
);

export type TypedProgram = {
  args: ProgramArg[];
  stmts: TypedStatement[];
};
