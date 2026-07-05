// Public programmatic API for the Ascent language toolchain.
// The `ascent` CLI (see index.ts) is the primary entry point. Embedders
// wanting source-to-typed-AST in one call should use parse():
//
//   const { program, errorMarkers } = parse(src);
//   const inputs = new ProgramInputs(program!.args).set('name', { type: 'String', value: 'Ada' });
//   const result = executeProgram(program!, inputs);
//
// The individual stages are also re-exported for tools that need
// intermediate results (e.g. tokens, or the untyped AST):
//
//   const { tokens, errorMarkers } = new Lexer(src).tokenize();
//   const { program } = parseTokens(tokens);
//   const { program: typedProgram } = typecheck(program!);

export { Lexer } from './lexer/index.js';
export type { LexResult } from './lexer/index.js';

export { parse, parseTokens } from './parser/index.js';
export type { ParseResult } from './parser/index.js';
export type { Program, ProgramArg } from './parser/ast.js';

export { typecheck } from './parser/typechecker.js';
export type { TypedResult } from './parser/typechecker.js';
export type { TypedProgram } from './parser/typed-ast.js';

export {
  Environment,
  evaluateExpr,
  executeStmt,
  executeProgram,
  ProgramInputs,
} from './interpreter.js';
export type { RuntimeValue, RuntimeResult, AssignResult, PrimitiveValue } from './interpreter.js';

export type { RuntimeError } from './errors/runtime-error.js';

export { formatExpr, formatStmt, formatValue, valueToString } from './parser/printer.js';
export { formatTypedStmt } from './parser/typed-printer.js';

export * from './types/types.js';

export { ERRORS, byCode } from './errors/index.js';
export type { ErrorEntry, Category } from './errors/types.js';
export type { Diagnostic } from './errors/elaborate.js';
