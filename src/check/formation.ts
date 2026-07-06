import type { TypeExpr, TypeName, ArgType } from '../parser/ast.js';
import { AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, listOfType, optionalOf } from '../types/types.js';

// ---- Type formation:  ⊢ T type --------------------------------------
//
// The one place a syntactic type name becomes a semantic AscentType.
// Total over the name union, so an unexpected name is a compile error
// here rather than a silent fall-through elsewhere.

export const typeFromName = (name: TypeName['name'] | ArgType): AscentType => {
  switch (name) {
    case 'Int': return INT_TYPE;
    case 'Float': return FLOAT_TYPE;
    case 'Bool': return BOOL_TYPE;
    case 'String': return STRING_TYPE;
  }
};

export const typeFromExpr = (te: TypeExpr): AscentType => {
  switch (te.kind) {
    case 'TypeName': return typeFromName(te.name);
    case 'ListType': return listOfType(typeFromExpr(te.elem));
    case 'OptionalType': return optionalOf(typeFromExpr(te.elem));
  }
};
