// Public programmatic API for the Ascent language toolchain.
// The `ascent` CLI (see index.ts) is the primary entry point. Embedders
// wanting source-to-typed-AST in one call should use parse():
//
//   const { program, diagnostics } = parse(src);
//   if (diagnostics.length > 0) { /* report them; do not execute */ }
//   const inputs = new ProgramInputs(program!.args).set('name', { type: 'String', value: 'Ada' });
//   const result = executeProgram(program!, { stdout: text => console.log(text) }, inputs);
//
// The program's output — every `print` call and its final value, each already
// rendered to text by the interpreter — is streamed to the OutputSink you pass;
// `result.value` is that same final value as a structured RuntimeValue (for a
// crash, `result.kind` is 'error' and carries the RuntimeError instead).
//
// `program` is non-null whenever typechecking itself ran — even for a
// program with type errors, it always returns a fully-typed tree for tooling
// (agenda/typechecker-refactor.md Phase 5) — so the diagnostics check above, not `program`'s
// nullness, is what decides whether it's safe to execute.
//
// The individual stages are also re-exported for tools that need
// intermediate results (e.g. tokens, or the untyped AST):
//
//   const { tokens, errorMarkers } = new Lexer(src).tokenize();
//   const { program } = parseTokens(tokens);
//   const { program: typedProgram } = typecheck(program!);

export { Lexer } from './lexer/index.js';
export type { LexResult } from './lexer/index.js';

// The token surface, for tools that consume the (lossless) token stream
// directly — e.g. a syntax highlighter: walk `tokens`, wrap each token's raw
// `text` in a span of its `syntaxClass`, skipping `isTrivia` kinds if desired.
export { isTrivia, syntaxClass } from './lexer/token.js';
export type { Token, TokenKind, SyntaxClass, Span, Position } from './lexer/token.js';

export { parse, parseTokens } from './parser/index.js';
export type { ParseResult } from './parser/index.js';
export type { Program, ProgramArg } from './parser/ast.js';

export { typecheck } from './check/index.js';
export type { TypedResult } from './check/index.js';
export type { TypedProgram } from './parser/typed-ast.js';

export {
  Environment,
  evaluateExpr,
  executeStmt,
  executeProgram,
  ProgramInputs,
} from './interpreter.js';
export type { RuntimeValue, RuntimeResult, AssignResult, ScalarValue, OutputSink } from './interpreter.js';

export type { RuntimeError } from './errors/runtime-error.js';

export { formatExpr, formatStmt, formatValue, valueToString } from './parser/printer.js';
export { formatTypedStmt } from './parser/typed-printer.js';

export * from './types/types.js';

export { ERRORS, byCode } from './errors/index.js';
export type { ErrorEntry, Category } from './errors/types.js';
export type { Diagnostic } from './errors/elaborate.js';
