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
// 'T orfail E' — sugar for the Result type `Success{ value: T } | Failure{ error: E }`
// (whitepaper §9). `ok` is the success type, `err` the failure type. Written only
// this way, never as a spelled-out 'Result<T, E>' name (parallel to Optional's
// 'T?'-only spelling).
export type ResultType = { kind: 'ResultType'; ok: TypeExpr; err: TypeExpr; span: Span };
// 'Fn(Int, String) -> Bool' — a function type in annotation position
// (whitepaper §5/§7). Capitalized (a type) and arrow-separated, where the 'fn'
// *literal* is lowercase and colon-separated. The parameter types are
// positional (no names, unlike a literal's params), and the result is required
// — a function that "returns nothing" returns 'Done', so there is always a
// result to write.
export type FnType = { kind: 'FnType'; params: TypeExpr[]; result: TypeExpr; span: Span };
// 'Task<T>' — the type of an inert async result (whitepaper §8). The same
// angle-bracket form as 'List<T>'; usually inferred (a slot bound to 'f!(x)'),
// but writable so a slot holding a prepared task can be annotated.
export type TaskType = { kind: 'TaskType'; elem: TypeExpr; span: Span };
export type TypeExpr = TypeName | ListType | OptionalType | ResultType | FnType | TaskType;

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

// One step of a 'with' update path (whitepaper §6) — a '.field' (a record) or
// an '[index]' (a list). A path is a chain of these, exactly the navigation an
// *access* expression uses to read that position, minus its root — so the
// update mirrors the read ('model with users[3].address.city = …').
export type PathStep = (
  | { kind: 'field'; field: string; fieldSpan: Span; span: Span }
  | { kind: 'index'; index: Expr; span: Span }
);

// One path-and-value of a 'with' update. Unlike a FieldInit — which uses ':'
// and *builds* a value — an update uses '=' and *assigns into a copy* of the
// base at the position `path` names; `value` is the new value, in which 'its'
// refers to the base. `path` has at least one step.
export type WithUpdate = { path: PathStep[]; value: Expr; span: Span };

// A 'match' pattern (whitepaper §5). v1 patterns are shallow, in exactly three
// kinds: a literal (a scalar constant compared against the subject), a variant
// (a union case matched by tag, binding a subset of its fields), and the 'else'
// catch-all. A literal pattern is a constant, so a String one is always a plain
// string — never an interpolation.
export type LiteralPattern = (
  | { kind: 'litPattern'; valueType: 'Int'; value: bigint; span: Span }
  | { kind: 'litPattern'; valueType: 'Float'; value: number; span: Span }
  | { kind: 'litPattern'; valueType: 'Bool'; value: boolean; span: Span }
  | { kind: 'litPattern'; valueType: 'String'; value: string; span: Span }
);
// 'Circle{ radius }' (or bare 'Red') — matches a union case by its tag and binds
// a subset of its fields to locals (whitepaper §5). The field syntax is exactly
// the destructuring FieldPattern (defined below), reused here. A bare tag (no
// braces, `fields: []`) matches the variant while binding nothing — the only way
// to match a case field-free, so it covers both a zero-field enum case ('Red')
// and a fielded variant matched for its tag alone; empty braces 'Red{}' are the
// banned redundant spelling (S0028), same one-spelling rule as construction.
export type VariantPattern = { kind: 'variantPattern'; tag: string; tagSpan: Span; fields: FieldPattern[]; span: Span };
// A lowercase name in pattern position — the way to match an Optional's *present*
// case and pull the value out (whitepaper §4/§7: Optional is 'None | value', with
// no 'Some(...)' wrapper, so the present value is bare and a binding names it).
// It matches any non-None value and binds it to `name` at the narrowed element
// type T (from a T? subject). The name is free — 'value', 'x', anything lowercase.
export type BindingPattern = { kind: 'bindingPattern'; name: string; nameSpan: Span; span: Span };
// 'None' in pattern position — matches an Optional's absent case. Its own kind
// (not a litPattern) because None isn't a scalar constant and not a variantPattern
// because None is a built-in constructor, not a user-declared union tag.
export type NonePattern = { kind: 'nonePattern'; span: Span };
export type Pattern = LiteralPattern | VariantPattern | BindingPattern | NonePattern | { kind: 'elsePattern'; span: Span };

// One arm of a 'match': the pattern to test and the expression to produce when
// it matches. The body is any expression — a bare value or a '{ … }' block.
export type MatchArm = { pattern: Pattern; body: Expr; span: Span };

// 'match subject { pat -> body; … }' — an expression that yields the body of
// the first arm whose pattern matches the subject (whitepaper §5). The subject
// is a bare expression, no parentheses (unlike an 'if'/'while' *condition*, §2)
// — the arms' braces delimit it. Exhaustiveness is a checker rule, not a
// grammar one.
export type Match = { kind: 'match'; subject: Expr; arms: MatchArm[]; span: Span };

// One parameter of an 'fn' literal — 'name: Type' (whitepaper §5). Unlike a
// program input (scalar-only, ProgramArg), a function parameter's type is a
// full TypeExpr, so it may be 'List<Int>', a user type, 'Int?', or itself an
// 'Fn(...) -> ...' type. Every parameter is an ordinary fixed slot in the body.
export type FnParam = { name: string; nameSpan: Span; type: TypeExpr; span: Span };

export type Expr = (
  | Literal
  | Template
  | { kind: 'slot'; name: string; span: Span }
  | { kind: 'call'; callee: string; args: Expr[]; span: Span }
  // 'fetchUser!(id)' — an async call: it *prepares* an inert 'Task<T>' with its
  // arguments bound, without running the body (whitepaper §8). The '!' mark is
  // mandatory (a bare async call is a compile error) and yields the task; the
  // only way to run it is 'await'. Bare-name callee only in v1 (like 'call'),
  // matching the whitepaper's 'name!(args)' form — computed async callees are
  // deferred with the rest of the concurrency surface.
  | { kind: 'asyncCall'; callee: string; args: Expr[]; span: Span }
  // 'await task' — starts a 'Task<T>' and waits, yielding the T (whitepaper §8).
  // Legal only in an async context (an 'async fn' body or the program/REPL top
  // level, its root); using it in a plain 'fn' is a compile error to mark that
  // function 'async' — the colored model, propagated.
  | { kind: 'await'; task: Expr; span: Span }
  // 'callee(args)' where `callee` is a *computed* expression, not a bare name —
  // currying ('adder(3)(4)'), a function pulled from a collection ('fns[0](x)'),
  // or an inline lambda applied ('(fn(x: Int): Int { x })(5)'). A bare-name
  // call 'f(args)' stays a 'call' (parseAtom), which is also where the builtin
  // 'print' lives; every other callee shape becomes an 'apply' (parseApply).
  | { kind: 'apply'; callee: Expr; args: Expr[]; span: Span }
  // 'fn(params): Ret { body }' (or the '=> expr' single-expression sugar, which
  // the parser desugars into a one-statement block) — a first-class function
  // value (whitepaper §5).
  // Made only this way ('fix f = fn(...)'); there is no 'fn name(...)'
  // declaration form. The body is an ordinary block whose last statement is the
  // return value (the block-value rule, §2), so there is one body form and no
  // arrow. Both the parameter types and the return type are mandatory (§7).
  // `async` marks an 'async fn(...)' (whitepaper §8): its color, so its call
  // requires '!' and yields a 'Task<returnType>'. The body may use 'await'.
  | { kind: 'fn'; params: FnParam[]; returnType: TypeExpr; body: Block; async: boolean; span: Span }
  // 'return expr' — an early exit from the enclosing function (whitepaper §5).
  // It is an *expression* (of type Never, §7), not a statement, so it composes
  // in value position — a 'match' arm ('… -> return e') or an 'if' branch — and
  // a block that ends in one has type Never. `value` is optional: a bare
  // 'return' yields Done (valid only when the function returns Done).
  | { kind: 'return'; value: Expr | null; span: Span }
  // 'abort "reason"' — a diverging expression (type Never, §7/§9) for a point
  // that should be unreachable: a proven-impossible 'match' arm or 'else', or a
  // broken invariant. `reason` is a required String (the only information there
  // is), so unlike 'return' there is no bare form. It composes anywhere a value
  // is expected because it diverges, and — unlike '.orAbort()' — is *not* the way
  // to skip a Result (it carries no error value to report).
  | { kind: 'abort'; reason: Expr; span: Span }
  | { kind: 'methodCall'; receiver: Expr; method: string; args: Expr[]; span: Span }
  // 'TypeName{ field: value, … }' — builds a value of a declared type
  // (whitepaper §6). `typeName` is the constructor: a variant tag (its own name
  // for a single-variant record). `braces` records whether a '{ … }' body was
  // written — false for a bare zero-field-variant construction ('Red'), true for
  // 'Tag{ … }'. The checker uses it to tell an empty-brace 'Red{}' (banned,
  // S0028) apart from the bare 'Red', since both carry no fields.
  | { kind: 'construct'; typeName: string; typeNameSpan: Span; fields: FieldInit[]; braces: boolean; span: Span }
  // 'base with path = value' (braceless, single) or 'base with { p1 = v1, … }'
  // (braced) — a new value derived from `base` with the positions named by each
  // path replaced (whitepaper §6). A path is a chain of '.field'/'[index]' steps
  // (freely mixed and nested — 'users[3].address.city'), the read navigation
  // reused as a write. `braces` records the braced spelling (as 'construct'
  // does). Inside a `value` (and any '[index]'), 'its' refers to the base (an
  // ordinary slot the checker / interpreter bind to it).
  | { kind: 'with'; base: Expr; updates: WithUpdate[]; braces: boolean; span: Span }
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
  // 'opt ?? default' — the Optional default operator (design.md §9). `left` must
  // be an Optional (or None): its present value flows out, or `right` is used
  // when it's None. Its own node (not a 'binary') because its typing is unlike
  // any arithmetic/comparison op — the left is unwrapped, not combined — and it
  // short-circuits (the default is only evaluated on None).
  | { kind: 'coalesce'; left: Expr; right: Expr; span: Span }
  // 'try expr' / 'try expr else [e] -> mapExpr' — the propagation shorthand for
  // an Optional/Result (whitepaper §9). On the good case (a present Optional
  // value, or a 'Success') it yields the unwrapped value; on the bad case it
  // early-returns from the enclosing function — the 'None'/'Failure' unchanged
  // for the plain form, or 'Failure{ error: mapExpr }' for the 'else' mapping
  // form. `elseClause` is null for the plain 'try'. Its own node (not desugared
  // in the parser) because its typing needs the enclosing function's return type.
  | { kind: 'try'; subject: Expr; elseClause: TryElse | null; span: Span }
  | Match
  | Block
  | If
);

// The 'else [e] -> mapExpr' tail of a 'try' (whitepaper §9). `binding` is the
// name the failing error is bound to inside `body` — null when omitted (the only
// allowed form on an Optional, whose absent case carries no error). `body`
// evaluates to the *new* error value that gets propagated as 'Failure{ error }'.
export type TryElse = { binding: { name: string; span: Span } | null; body: Expr; span: Span };

// Unlike 'if', 'while'/'for' are statements, not expressions — a loop has
// no single meaningful result (zero iterations has no last value to
// give), so they always yield Done rather than forcing a fake one.
// One 'name: Type' field of a record's type declaration (design.md §6).
// Unlike a FieldInit (which carries a value), this carries the field's
// declared *type*.
export type FieldDecl = { name: string; nameSpan: Span; type: TypeExpr; span: Span };

// One variant of a tagged-union 'type' (whitepaper §6). `tag` is the
// variant's constructor name (UpperCamel) — 'Circle' in
// 'type Shape = Circle{ radius: Float } | …' — and `fields` its own record of
// fields, possibly empty. A single-variant record ('type User = { … }') is
// just the one-variant case whose tag is auto-named after the type.
export type VariantDecl = { tag: string; tagSpan: Span; fields: FieldDecl[]; span: Span };

// One field entry of a record destructuring pattern (whitepaper §5). `field` is
// the declared field name read off the value; `bind` is the local it's bound to
// — equal to `field` when punned ('{ name }'), a different name when renamed
// ('{ name: local }'). Shallow: a field binds a plain name, never a nested
// pattern (v1 patterns don't nest), so this reuses the exact match-arm field
// syntax, just in binding position.
export type FieldPattern = { field: string; fieldSpan: Span; bind: string; bindSpan: Span; span: Span };

// The binding target of a 'fix'/'mut' — either a plain name, or an irrefutable
// record pattern that destructures a single-variant record's fields into locals
// in one statement (whitepaper §5, the honest replacement for tuples). Naming a
// *subset* of fields is fine — the rest are ignored. A refutable pattern (a
// multi-variant union's case, which might not match) is rejected by the checker
// (T0033); a plain name always binds. Only a name target may carry a ':' type
// annotation — a record pattern already names its type.
export type BindTarget = (
  | { kind: 'name'; name: string; nameSpan: Span; span: Span }
  | { kind: 'record'; typeName: string; typeNameSpan: Span; fields: FieldPattern[]; span: Span }
);

export type Statement = (
  | { kind: 'fix'; target: BindTarget; typeAnnotation: TypeExpr | null; init: Expr; span: Span }
  | { kind: 'mut'; target: BindTarget; typeAnnotation: TypeExpr | null; init: Expr; span: Span }
  | { kind: 'assign'; name: string; nameSpan: Span; value: Expr; span: Span }
  // 'type Name = Variant{ … } | Variant{ … };' — declares a tagged-union type
  // (whitepaper §6). A record ('type Name = { … }') is the single-variant case,
  // its sole constructor's tag auto-named after the type; the explicit
  // 'type Name = Name{ … }' spelling and the multi-variant union both land in
  // the same `variants` list.
  | { kind: 'typeDecl'; name: string; nameSpan: Span; variants: VariantDecl[]; span: Span }
  | { kind: 'expr'; expr: Expr; span: Span }
  // 'void expr' — evaluates `expr` for its effect and discards its value, so
  // the statement itself yields Done (whitepaper §2). It's a statement, not an
  // expression operator: it only ever stands in statement position, and taking
  // a full expression is what makes 'void x + 1' discard 'x + 1', not '(void x) + 1'.
  | { kind: 'void'; expr: Expr; span: Span }
  | { kind: 'while'; cond: Expr; body: Block; span: Span }
  // 'for target in iterable { … }' — iterates the values of a List or the
  // numbers of a Range (design.md §5), binding each to `target` in the body.
  // No parens (it has no test); `target` is a fresh, per-iteration binding —
  // a plain name, or a record pattern that destructures each element (§5), the
  // same BindTarget a fix/mut declaration takes.
  | { kind: 'for'; target: BindTarget; iterable: Expr; body: Block; span: Span }
);

export type ArgType = 'Int' | 'Float' | 'Bool' | 'String';
export type ProgramArg = { name: string; type: ArgType };

// `stmts` is the whole top-level statement sequence; `bodyStart` is the index
// where the `program (…) { … }` body begins — i.e. the number of *leading*
// statements written before 'program' (whitepaper §11, revised rule: anything
// may precede 'program', nothing follows it). Statements before `bodyStart` are
// Done-required setup that run first and cannot see the inputs; the inputs
// (`args`) bind only from `bodyStart` on (the body), and the program's value is
// the body's last statement. `bodyStart` is 0 for a bare program (no leading, no
// inputs — every statement is body).
export type Program = { args: ProgramArg[]; stmts: Statement[]; bodyStart: number };
