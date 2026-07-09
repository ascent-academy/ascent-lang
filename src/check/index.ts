import type { Program } from '../parser/ast.js';
import type { TypedProgram, TypedStatement } from '../parser/typed-ast.js';
import type { Diagnostic } from '../errors/elaborate.js';
import { TypeEnv } from './env.js';
import { Diagnostics } from './diagnostics.js';
import { typeFromName } from './formation.js';
import { inferStmt, reportDroppedValue } from './stmt.js';

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

  // The inputs bind right before the body begins (whitepaper §11, revised rule),
  // so they're in scope only from `bodyStart` on — the leading setup statements
  // above cannot see them (sequential scoping: 'program' comes after them). An
  // empty body never reaches `bodyStart` in the loop, so bind the inputs upfront
  // in that degenerate case (they're unused, but keeps the tree consistent).
  const bindArgs = (): void => {
    for (const arg of program.args) env.set(arg.name, typeFromName(arg.type), 'arg');
  };
  if (program.bodyStart >= program.stmts.length) bindArgs();

  // The body's last statement is the program's value (whitepaper §2); every
  // other statement — all the leading setup, and every non-final body statement
  // — sits in a Done-required position, so a real value left there is dropped
  // (T0025).
  const lastIndex = program.stmts.length - 1;
  const typedStmts: TypedStatement[] = program.stmts.map((stmt, i) => {
    if (i === program.bodyStart) bindArgs();
    const typedStmt = inferStmt(stmt, env, diagnostics);
    const isValuePosition = i >= program.bodyStart && i === lastIndex;
    if (!isValuePosition) {
      reportDroppedValue(typedStmt, 'T0025', diagnostics);
    }
    return typedStmt;
  });

  if (diagnostics.hasErrors) {
    return { program: { args: program.args, stmts: typedStmts, bodyStart: program.bodyStart }, diagnostics: diagnostics.elaborate(source) };
  }

  if (parentEnv !== undefined) {
    for (const [name, binding] of env.ownEntries()) {
      parentEnv.set(name, binding.ty, binding.origin, binding.declSpan);
    }
    // Types declared this line persist into later REPL lines too, alongside
    // slots — so 'type Person = …' on one line is usable on the next.
    for (const [, info] of env.ownTypeEntries()) {
      parentEnv.setType(info);
    }
    // Imports likewise persist, so an 'import { min } from "math"' on one REPL
    // line keeps 'min' (or a 'math' namespace) callable on the next.
    for (const [name, module] of env.ownImportedFns()) {
      parentEnv.setImportedFn(name, module);
    }
    for (const [name, module] of env.ownNamespaces()) {
      parentEnv.setNamespace(name, module);
    }
  }

  return { program: { args: program.args, stmts: typedStmts, bodyStart: program.bodyStart }, diagnostics: [] };
};
