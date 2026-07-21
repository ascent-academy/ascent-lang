import type { TypeExpr, ArgType } from '../parser/ast.js';
import {
  AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, DONE_TYPE, INVALID_TYPE,
  listOfType, optionalOf, resultOf, namedType, functionType, taskOf,
} from '../types/types.js';
import type { TypeEnv } from './env.js';
import type { Diagnostics } from './diagnostics.js';

// ---- Type formation:  ⊢ T type --------------------------------------
//
// The one place a syntactic type name becomes a semantic AscentType. A
// built-in scalar name resolves outright; any other UpperCamel name must
// name a declared type in scope, else it's an N0005 (unknown type) — so an
// unknown or misspelled type name is caught here rather than fell through.

// The built-in scalars only — an 'args' type is always one of these
// (design.md §11), and so is a TypeName that isn't a user type.
export const typeFromName = (name: ArgType): AscentType => {
  switch (name) {
    case 'Int': return INT_TYPE;
    case 'Float': return FLOAT_TYPE;
    case 'Bool': return BOOL_TYPE;
    case 'String': return STRING_TYPE;
  }
};

const BUILTIN_SCALARS: ReadonlySet<string> = new Set(['Int', 'Float', 'Bool', 'String']);

// Every built-in type name — the scalars, List, and Result — plus the two
// built-in Result constructors 'Success'/'Failure', which are likewise
// non-shadowable (whitepaper §2/§9). One source of truth: a 'type' declaration
// can't reuse any of these (N0008), and none can be used as a bare value
// (N0012). Shared by the checker's stmt/synth passes.
export const BUILTIN_TYPE_NAMES: ReadonlySet<string> = new Set(['Int', 'Float', 'Bool', 'String', 'List', 'Result', 'Success', 'Failure']);

export const typeFromExpr = (te: TypeExpr, env: TypeEnv, diagnostics: Diagnostics): AscentType => {
  switch (te.kind) {
    case 'TypeName': {
      // 'Done', the unit type — admitted in type position (parseTypeExpr) even
      // though the word lexes as a value constructor. A function that returns no
      // information returns 'Done' (whitepaper §4).
      if (te.name === 'Done') return DONE_TYPE;
      if (BUILTIN_SCALARS.has(te.name)) return typeFromName(te.name as ArgType);
      // A user type: it must already be declared (types are sequential, like
      // value bindings). An undeclared name is N0005; Invalid stops the failure
      // from cascading into whatever annotation or field used it.
      if (env.getType(te.name) !== null) return namedType(te.name);
      diagnostics.error({ code: 'N0005', span: te.span, data: { name: te.name } });
      return INVALID_TYPE;
    }
    case 'ListType': return listOfType(typeFromExpr(te.elem, env, diagnostics));
    case 'OptionalType': {
      const inner = typeFromExpr(te.elem, env, diagnostics);
      // A '?' applied to something already Optional — a written 'String??' or
      // '(String?)?'. Optional doesn't nest (no runtime 'Some(…)', §4/§7), so the
      // extra '?' is redundant: report it (T0047), then let optionalOf collapse
      // it away. (Only source-written '?' reaches here; a nested Optional formed
      // by composition is collapsed silently in optionalOf, never routed through
      // this case.)
      if (inner.kind === 'Optional') {
        diagnostics.error({ code: 'T0047', span: te.span });
      }
      return optionalOf(inner);
    }
    case 'ResultType': return resultOf(
      typeFromExpr(te.ok, env, diagnostics),
      typeFromExpr(te.err, env, diagnostics),
    );
    case 'FnType': return functionType(
      te.params.map(p => typeFromExpr(p, env, diagnostics)),
      typeFromExpr(te.result, env, diagnostics),
      te.async,
    );
    // 'Task<T>' — the inert async result (whitepaper §8). A 'Fn(...)' type
    // carries its own 'async' flag; a Task carries just its awaited result type.
    case 'TaskType': return taskOf(typeFromExpr(te.elem, env, diagnostics));
  }
};
