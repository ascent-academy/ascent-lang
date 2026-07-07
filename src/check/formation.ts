import type { TypeExpr, ArgType } from '../parser/ast.js';
import {
  AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, INVALID_TYPE,
  listOfType, optionalOf, namedType,
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

export const typeFromExpr = (te: TypeExpr, env: TypeEnv, diagnostics: Diagnostics): AscentType => {
  switch (te.kind) {
    case 'TypeName': {
      if (BUILTIN_SCALARS.has(te.name)) return typeFromName(te.name as ArgType);
      // A user type: it must already be declared (types are sequential, like
      // value bindings). An undeclared name is N0005; Invalid stops the failure
      // from cascading into whatever annotation or field used it.
      if (env.getType(te.name) !== null) return namedType(te.name);
      diagnostics.error({ code: 'N0005', span: te.span, data: { name: te.name } });
      return INVALID_TYPE;
    }
    case 'ListType': return listOfType(typeFromExpr(te.elem, env, diagnostics));
    case 'OptionalType': return optionalOf(typeFromExpr(te.elem, env, diagnostics));
  }
};
