import type { Program } from '../parser/ast.js';
import type { TypedProgram, TypedStatement } from '../parser/typed-ast.js';
import type { Diagnostic } from '../errors/elaborate.js';
import { TypeEnv } from './env.js';
import { Diagnostics } from './diagnostics.js';
import { typeFromName } from './formation.js';
import { inferStmt } from './stmt.js';

export { TypeEnv } from './env.js';

export interface TypedResult {
  program: TypedProgram | null;
  diagnostics: Diagnostic[];
}

// parentEnv lets a caller (the REPL) carry name bindings across separate
// typecheck() calls: each call type-checks into a child scope, and only
// promotes its new bindings into parentEnv once the whole program's
// diagnostics come back empty, so a line that fails typechecking never
// leaks a partial declaration into later lines.
//
// Since Phase 5, this always returns a fully-typed tree — even a program
// with type errors gets one, built from Invalid wherever a node failed to
// check (agenda/typechecker-refactor.md) — instead of throwing it away on
// the first error, which is what editor tooling wants. That tree is a
// *tooling* artifact only: callers must still gate execution on
// `diagnostics.length === 0` (as every caller in this codebase already
// does), never on `program` being non-null, since a broken program's tree
// still contains Invalid nodes that must never reach the interpreter.
export const typecheck = (program: Program, source: string, parentEnv?: TypeEnv): TypedResult => {
  const diagnostics = new Diagnostics();
  const env = parentEnv !== undefined ? parentEnv.child() : new TypeEnv();

  for (const arg of program.args) {
    env.set(arg.name, typeFromName(arg.type), 'arg');
  }

  const typedStmts: TypedStatement[] = program.stmts.map(stmt => inferStmt(stmt, env, diagnostics));

  if (diagnostics.hasErrors) {
    return { program: { args: program.args, stmts: typedStmts }, diagnostics: diagnostics.elaborate(source) };
  }

  if (parentEnv !== undefined) {
    for (const [name, binding] of env.ownEntries()) {
      parentEnv.set(name, binding.ty, binding.origin, binding.declSpan);
    }
  }

  return { program: { args: program.args, stmts: typedStmts }, diagnostics: [] };
};
