import type { Span } from '../lexer/token.js';
import type { UnaryOp, BinaryOp, ProgramArg, TypeExpr, Pattern, ImportClause } from './ast.js';
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

// One step of a typed 'with' update path — a '.field' or an '[index]' (whose
// index expression is checked to Int). The interpreter walks these from the
// base to reach the position to replace.
export type TypedPathStep = (
  | { kind: 'field'; field: string }
  | { kind: 'index'; index: TypedExpr }
);

// One path-and-value of a typed 'with' update. `declaredType` is the leaf
// position's type — the field/element type at the end of `path` — into which
// the interpreter coerces `value` (e.g. Int → Float), exactly as a construction
// field or a fix/mut init does.
export type TypedWithUpdate = { path: TypedPathStep[]; declaredType: AscentType; value: TypedExpr };

export type TypedExpr = (
  | TypedLiteral
  | TypedTemplate
  | { kind: 'slot'; name: string; type: AscentType; span: Span }
  // A by-name call: an ambient builtin ('print'), a user function, or — when
  // `module` is set — a stdlib module export (whitepaper §10). Both import forms
  // resolve to this one node: a named import's bare 'min(…)' and a namespace
  // import's 'math.min(…)' alike become a 'call' with `module` = "math" and
  // `callee` = "min", so the interpreter dispatches every stdlib function one way
  // (the module registry) regardless of which import spelling reached it.
  | { kind: 'call'; callee: string; module?: string; args: TypedExpr[]; type: AscentType; span: Span }
  // Calling a computed function value (see Expr's 'apply' in ast.ts). `callee`
  // is checked to a Function type; `type` is that function's result.
  | { kind: 'apply'; callee: TypedExpr; args: TypedExpr[]; type: AscentType; span: Span }
  // 'fetchUser!(id)' — prepares an inert Task (whitepaper §8). `type` is
  // 'Task<result>'; the interpreter evaluates the arguments (binding them) and
  // captures the function value, but does not run the body until 'await'.
  | { kind: 'asyncCall'; callee: string; args: TypedExpr[]; type: AscentType; span: Span }
  // 'await task' — runs the Task and yields its value (whitepaper §8). `type` is
  // the awaited result T (the task's result type). The interpreter runs the
  // task's body synchronously here (no scheduler in v1) and returns its value.
  | { kind: 'await'; task: TypedExpr; type: AscentType; span: Span }
  | { kind: 'methodCall'; receiver: TypedExpr; method: string; args: TypedExpr[]; type: AscentType; span: Span }
  | { kind: 'construct'; typeName: string; fields: TypedFieldInit[]; type: AscentType; span: Span }
  // 'base with field = value' — an updated copy of a record (whitepaper §6).
  // `type` is the base's (record) type, unchanged by the update. `updates` are in
  // source order; the interpreter starts from a copy of the base and overwrites
  // each named field.
  | { kind: 'with'; base: TypedExpr; updates: TypedWithUpdate[]; type: AscentType; span: Span }
  | { kind: 'fieldAccess'; receiver: TypedExpr; field: string; type: AscentType; span: Span }
  | { kind: 'list'; elements: TypedExpr[]; type: AscentType; span: Span }
  | { kind: 'range'; lo: TypedExpr; hi: TypedExpr; type: AscentType; span: Span }
  | { kind: 'index'; list: TypedExpr; index: TypedExpr; type: AscentType; span: Span }
  | { kind: 'unary'; op: UnaryOp; operand: TypedExpr; type: AscentType; span: Span }
  | { kind: 'binary'; op: BinaryOp; left: TypedExpr; right: TypedExpr; type: AscentType; span: Span }
  // 'opt ?? default' (design.md §9). `type` is the least common type of the
  // optional's present type (left's Optional element) and `right`'s type — the
  // interpreter coerces whichever branch it takes into it, exactly as an 'if'
  // widens the branch it runs to the join type.
  | { kind: 'coalesce'; left: TypedExpr; right: TypedExpr; type: AscentType; span: Span }
  | TypedFn
  | TypedReturn
  | TypedAbort
  | TypedTry
  | TypedMatch
  | TypedBlock
  | TypedIf
);

// The typed 'else [e] -> mapExpr' tail of a 'try' (whitepaper §9). `binding` is
// the local the failing error is bound to inside `body` (null when omitted); the
// interpreter binds the Failure's `error` field to it. `body` yields the new
// error value, propagated as 'Failure{ error }'.
export type TypedTryElse = { binding: string | null; body: TypedExpr };

// 'try expr' / 'try expr else …' typed (whitepaper §9). `type` is the unwrapped
// good value's type T (what the whole expression yields on the success path) —
// the divergence on the bad path is a runtime early-return, so it doesn't make
// the type Never. `returnType` is the enclosing function's declared return type,
// and `propagateType` is the static type of the value returned on the bad path
// (a 'Result<Never, E>' or 'None'); the interpreter coerces the propagated value
// from `propagateType` into `returnType`, exactly as a 'return' coerces its value.
export type TypedTry = {
  kind: 'try';
  subject: TypedExpr;
  elseClause: TypedTryElse | null;
  returnType: AscentType;
  propagateType: AscentType;
  type: AscentType;
  span: Span;
};

// One typed parameter of a function value — its name and the AscentType its
// declared TypeExpr formed into. The interpreter binds each argument to `name`
// (coercing into `type`) when the function is applied.
export type TypedFnParam = { name: string; type: AscentType };

// 'fn(params): Ret { body }' typed (whitepaper §5). `type` is the Function
// type formed from the signature (its params/result mirror `params` and the
// body's expected return). `captures` is the set of outer names the body uses
// that are bound above the function — the interpreter snapshots exactly these
// by value at closure-creation time (capture-by-value, §5), keeping the closure
// cheap and its dependencies legible.
export type TypedFn = {
  kind: 'fn';
  params: TypedFnParam[];
  body: TypedBlock;
  captures: string[];
  // The function's color (whitepaper §8) — mirrors `type`'s `async` flag; kept
  // here so the printer / tooling can show it without unpacking the type.
  async: boolean;
  type: AscentType;
  span: Span;
};

// 'return expr' typed (whitepaper §5). `type` is always Never — a return
// diverges, so it satisfies any expected type and makes a block that ends in it
// diverge too (§7). `returnType` is the enclosing function's declared return
// type: the interpreter coerces the returned value into it (Int → Float, etc.),
// exactly as the function's fall-through value is coerced. `value` is null for a
// bare 'return' (which yields Done).
export type TypedReturn = {
  kind: 'return';
  value: TypedExpr | null;
  returnType: AscentType;
  type: AscentType;
  span: Span;
};

// 'abort "reason"' typed (whitepaper §7/§9). `type` is always Never — abort
// diverges, so it satisfies any expected type and makes an enclosing block
// diverge too. `reason` is the checked String the interpreter evaluates and
// reports when it crashes (bug-tier, R0008). Unlike 'return'/'try' it needs no
// enclosing-function context: it never hands a value back, it just stops.
export type TypedAbort = {
  kind: 'abort';
  reason: TypedExpr;
  type: AscentType;
  span: Span;
};

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
  // A resolved import (whitepaper §10). It has no runtime effect — the checker
  // has already rewritten every use into a 'call' with `module` set — so the
  // interpreter no-ops it; the clause/module ride along only for the printer.
  | { kind: 'import'; clause: ImportClause; module: string; span: Span }
);

export type TypedProgram = {
  args: ProgramArg[];
  stmts: TypedStatement[];
  // The index into `stmts` where the program body begins (see Program in
  // ast.ts). The interpreter binds the inputs right before this point, so they
  // are in scope only for the body, not the leading setup statements above it.
  bodyStart: number;
};
