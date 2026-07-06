import type { Expr } from '../parser/ast.js';
import type { Span } from '../lexer/token.js';
import type { TypedExpr } from '../parser/typed-ast.js';
import { AscentType, leastCommonType, isAssignableTo, listOfType } from '../types/types.js';
import type { TypeEnv } from './env.js';
import { Diagnostics, typeMismatch } from './diagnostics.js';
import { synth, joinElementTypes } from './synth.js';

// ---- Expression checking:  Γ ⊢ e ⇐ T ---------------------------------
//
// An expected type flows in from the use site — today that's only a
// fix/mut annotation, via `related`, the span(s) to attach to a mismatch
// (e.g. "annotation" pointing back at the written type). `expected` always
// comes from a written TypeExpr (never Invalid — Invalid can't be named in
// source, agenda/typechecker-refactor.md Phase 5 Rule 3), so only the
// synthesized side ever needs Invalid-awareness. The default rule covers
// almost every form: synthesize, then require the result <: expected,
// recording T0001 when it isn't — subtype()'s own Invalid-absorption already
// keeps that check quiet when synth produced Invalid, with no
// special-casing needed here. Two forms of a list literal override the
// default because the expectation reshapes the synthesized node instead of
// merely being compared against it (design.md §7):
//   • empty list []  — adopts `expected` as its own type outright
//   • non-empty list — its elements' joined type widens toward
//     `expected`'s element type (e.g. Int elements under a List<Float>
//     expectation), so the interpreter can coerce from the node's own
//     `.type.elem` later
export const check = (
  expr: Expr, expected: AscentType, env: TypeEnv, diagnostics: Diagnostics,
  related: { key: string; span: Span }[] = [],
): TypedExpr => {
  if (expr.kind === 'list' && expr.elements.length === 0 && expected.kind === 'List') {
    return { kind: 'list', elements: [], type: expected, span: expr.span };
  }

  if (expr.kind === 'list' && expr.elements.length > 0) {
    const typedElements = expr.elements.map(el => synth(el, env, diagnostics));
    let elemType = joinElementTypes(typedElements, expr.span, diagnostics);
    if (expected.kind === 'List') {
      const ct = leastCommonType(elemType, expected.elem);
      if (ct !== null) elemType = ct;
    }
    const node: TypedExpr = { kind: 'list', elements: typedElements, type: listOfType(elemType), span: expr.span };
    if (!isAssignableTo(node.type, expected)) {
      typeMismatch('T0001', diagnostics, node.span, expected, node.type, related);
    }
    return node;
  }

  const node = synth(expr, env, diagnostics);
  if (!isAssignableTo(node.type, expected)) {
    typeMismatch('T0001', diagnostics, node.span, expected, node.type, related);
  }
  return node;
};
