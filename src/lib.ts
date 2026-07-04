// Public programmatic API for the Ascent language toolchain.
// The `ascent` CLI (see index.ts) is the primary entry point, but the
// individual stages are re-exported here so tools can embed the pipeline:
//
//   const { tokens, errorMarkers } = new Lexer(src).tokenize();
//   const { program } = new Parser(tokens).parse();
//   const { typedProgram } = typecheck(program!);
//   const result = executeProgram(typedProgram!, new Environment());

export { Lexer } from './lexer/index.js';
export type { LexResult } from './lexer/index.js';

export { Parser } from './parser/index.js';
export type { ParseResult } from './parser/index.js';

export { typecheck } from './parser/typechecker.js';
export type { TypeCheckResult } from './parser/typechecker.js';

export {
  Environment,
  evaluateExpr,
  executeStmt,
  executeProgram,
} from './interpreter.js';
export type { RuntimeValue, AssignResult } from './interpreter.js';

export { formatExpr, formatStmt, formatValue } from './parser/printer.js';
export { formatTypedStmt } from './parser/typed-printer.js';

export * from './types/types.js';

export { ERRORS, byCode } from './errors/index.js';
export type { ErrorEntry, Category } from './errors/types.js';
