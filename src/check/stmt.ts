import type { Statement, Block, If } from '../parser/ast.js';
import type { TypedBlock, TypedIf, TypedExpr, TypedStatement } from '../parser/typed-ast.js';
import { AscentType, INT_TYPE, DONE_TYPE, INVALID_TYPE, isInvalidType, containsNever, typeToString, leastCommonType, isAssignableTo } from '../types/types.js';
import type { TypeEnv } from './env.js';
import { Diagnostics } from './diagnostics.js';
import { typeFromExpr } from './formation.js';
import { synth } from './synth.js';
import { check } from './check.js';

export const inferBlock = (block: Block, env: TypeEnv, diagnostics: Diagnostics): TypedBlock => {
  const inner = env.child();
  const typedStmts: TypedStatement[] = [];
  let blockType: AscentType = DONE_TYPE;

  for (const stmt of block.stmts) {
    const typedStmt = inferStmt(stmt, inner, diagnostics);
    typedStmts.push(typedStmt);
    blockType = typedStmt.kind === 'expr' ? typedStmt.expr.type : DONE_TYPE;
  }

  return { kind: 'block', stmts: typedStmts, type: blockType, span: block.span };
};

export const inferIf = (expr: If, env: TypeEnv, diagnostics: Diagnostics): TypedIf => {
  const typedCond = synth(expr.cond, env, diagnostics);
  // An Invalid condition already carries its own reported failure — it
  // doesn't decide *what type* the 'if' produces (that's the branches'
  // job), so only the Bool check gets suppressed here, not the branch join
  // below (T0004 and T0005 inspect different things and stay independent).
  if (!isInvalidType(typedCond.type) && typedCond.type.kind !== 'Bool') {
    diagnostics.error({ code: 'T0004', span: expr.cond.span, data: { actual: typeToString(typedCond.type) } });
  }

  const typedThen = inferBlock(expr.then, env, diagnostics);

  if (expr.else === null) {
    return { kind: 'if', cond: typedCond, then: typedThen, else: null, type: DONE_TYPE, span: expr.span };
  }

  const typedElse: TypedBlock | TypedIf = expr.else.kind === 'if'
    ? inferIf(expr.else, env, diagnostics)
    : inferBlock(expr.else, env, diagnostics);

  const ct = leastCommonType(typedThen.type, typedElse.type);
  if (ct === null) {
    diagnostics.error({
      code: 'T0005', span: expr.span,
      data: { then: typeToString(typedThen.type), else: typeToString(typedElse.type) },
      related: [
        { key: 'then', span: typedThen.span },
        { key: 'else', span: typedElse.span },
      ],
    });
  }

  return { kind: 'if', cond: typedCond, then: typedThen, else: typedElse, type: ct ?? INVALID_TYPE, span: expr.span };
};

export const inferStmt = (stmt: Statement, env: TypeEnv, diagnostics: Diagnostics): TypedStatement => {
  switch (stmt.kind) {
    case 'fix':
    case 'mut': {
      const annotation = stmt.typeAnnotation !== null ? typeFromExpr(stmt.typeAnnotation) : null;

      let typedInit: TypedExpr;
      let slotType: AscentType;
      if (annotation !== null) {
        // The written annotation always wins as the slot's type, even when
        // the init expression itself failed to check
        // (agenda/typechecker-refactor.md Phase 5's "quality lever": prefer
        // a real, declared type over Invalid so the failure stops here
        // instead of freezing every later use of the slot at Invalid too).
        typedInit = check(stmt.init, annotation, env, diagnostics, [{ key: 'annotation', span: stmt.typeAnnotation!.span }]);
        slotType = annotation;
      } else {
        typedInit = synth(stmt.init, env, diagnostics);
        if (isInvalidType(typedInit.type)) {
          // Its own failure was already reported where it was synthesized —
          // don't also demand an annotation for a type that was never real.
        } else if (typedInit.type.kind === 'None') {
          // design.md §7's slot-inference wrinkle: a bare 'None' carries no
          // type information (there's nothing to widen it to) — so it needs
          // a written annotation too.
          diagnostics.error({ code: 'T0015', span: stmt.init.span });
        } else if (containsNever(typedInit.type)) {
          // Same wrinkle for a bare '[]' (or anything built from one, like
          // '[].reverse()'): List<Never> would otherwise freeze the slot at
          // a type nothing can ever be assigned back into (T0003 —
          // 'append' works fine as a standalone expression, since there
          // Never widens freely; only a *fixed slot type* can't take that
          // widened value back once reassigned).
          diagnostics.error({ code: 'T0003', span: stmt.init.span });
        }
        slotType = typedInit.type;
      }

      env.set(stmt.name, slotType, stmt.kind, stmt.span);

      return {
        kind: stmt.kind,
        name: stmt.name,
        typeAnnotation: stmt.typeAnnotation,
        slotType,
        init: typedInit,
        span: stmt.span,
      };
    }

    case 'assign': {
      const binding = env.get(stmt.name);
      if (binding === null) {
        // Assigning to a name that was never created — a different mistake
        // (and lesson) than using an undefined name in an expression (N0001).
        diagnostics.error({ code: 'N0003', span: stmt.nameSpan });
      } else if (binding.origin === 'arg') {
        // A program input is read-only for the whole run — its own lesson,
        // distinct from a 'fix' slot (there is no 'mut' arg to switch to).
        diagnostics.error({ code: 'N0004', span: stmt.nameSpan });
      } else if (binding.origin === 'fix') {
        // Point back at the 'fix' declaration ("created with 'fix' here"),
        // which always has a source location.
        const related = binding.declSpan !== null
          ? [{ key: 'declaration', span: binding.declSpan }]
          : [];
        diagnostics.error({ code: 'N0002', span: stmt.nameSpan, related });
      }
      const typedValue = synth(stmt.value, env, diagnostics);
      if (binding !== null && !isAssignableTo(typedValue.type, binding.ty)) {
        const related = binding.declSpan !== null ? [{ key: 'declaration', span: binding.declSpan }] : [];
        diagnostics.error({
          code: 'T0001', span: stmt.value.span,
          data: { expected: typeToString(binding.ty), actual: typeToString(typedValue.type) },
          related,
        });
      }
      return {
        kind: 'assign',
        name: stmt.name,
        slotType: binding?.ty ?? DONE_TYPE,
        value: typedValue,
        span: stmt.span,
      };
    }

    case 'while': {
      const typedCond = synth(stmt.cond, env, diagnostics);
      if (!isInvalidType(typedCond.type) && typedCond.type.kind !== 'Bool') {
        diagnostics.error({ code: 'T0004', span: stmt.cond.span, data: { actual: typeToString(typedCond.type) } });
      }
      const typedBody = inferBlock(stmt.body, env, diagnostics);
      return { kind: 'while', cond: typedCond, body: typedBody, span: stmt.span };
    }

    case 'for': {
      const typedIterable = synth(stmt.iterable, env, diagnostics);
      const it = typedIterable.type;
      // What each iteration binds `name` to: a List's element type, or Int
      // for a Range (design.md §5). Anything else can't be iterated — T0017.
      // An already-Invalid iterable stays Invalid without a second error.
      let elemType: AscentType;
      if (isInvalidType(it)) {
        elemType = INVALID_TYPE;
      } else if (it.kind === 'List') {
        elemType = it.elem;
      } else if (it.kind === 'Range') {
        elemType = INT_TYPE;
      } else {
        diagnostics.error({ code: 'T0017', span: stmt.iterable.span, data: { actual: typeToString(it) } });
        elemType = INVALID_TYPE;
      }

      // The loop variable is a fresh fixed binding scoped to the body — a
      // new one each iteration (value semantics), so reassigning it inside
      // the body is an N0002 error, like any other 'fix'. inferBlock opens
      // its own child under this, so the binding is visible throughout it.
      const inner = env.child();
      inner.set(stmt.name, elemType, 'fix', stmt.nameSpan);
      const typedBody = inferBlock(stmt.body, inner, diagnostics);
      return { kind: 'for', name: stmt.name, elemType, iterable: typedIterable, body: typedBody, span: stmt.span };
    }

    case 'expr': {
      return { kind: 'expr', expr: synth(stmt.expr, env, diagnostics), span: stmt.span };
    }
  }
};
