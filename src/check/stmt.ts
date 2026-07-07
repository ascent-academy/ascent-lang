import type { Statement, Block, If, Match, LiteralPattern } from '../parser/ast.js';
import type { Span } from '../lexer/token.js';
import type { TypedBlock, TypedIf, TypedMatch, TypedMatchArm, TypedExpr, TypedStatement } from '../parser/typed-ast.js';
import { AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, DONE_TYPE, INVALID_TYPE, isInvalidType, containsNever, typeToString, leastCommonType, isAssignableTo } from '../types/types.js';
import type { TypeEnv, RecordField, Variant } from './env.js';
import type { TypedVariantDecl } from '../parser/typed-ast.js';
import { Diagnostics } from './diagnostics.js';
import { typeFromExpr } from './formation.js';
import { synth } from './synth.js';
import { check } from './check.js';

// The type names the language already owns — a 'type' declaration can't
// redeclare one (N0008). None/Done/True/False aren't here: they lex as value
// constructors, never TYPE_NAME, so they can't reach a type-name position.
const BUILTIN_TYPE_NAMES: ReadonlySet<string> = new Set(['Int', 'Float', 'Bool', 'String', 'List']);

// The "value must go somewhere" rule (whitepaper §2). A statement in a
// *Done-required* position — one whose value nothing consumes — may not leave
// a real value behind: that's the silent-no-op bug (calling `xs.sort()` for
// effect and dropping the new list it returns). Only an 'expr' statement can
// carry such a value; every other kind (fix/mut/assign/typeDecl/while/for/void)
// already yields Done. Done has nothing to drop, Invalid already reported its
// own failure, and Never is divergence (no value ever arrives) — none of those
// is a dropped value, so they're allowed through.
const droppedValue = (stmt: TypedStatement): TypedExpr | null => {
  if (stmt.kind !== 'expr') return null;
  const t = stmt.expr.type;
  if (t.kind === 'Done' || t.kind === 'Invalid' || t.kind === 'Never') return null;
  return stmt.expr;
};

// Report the drop, if any: T0025 when a *following statement* discards it,
// T0026 when a *loop* discards it each pass. The fix for both is the same —
// consume the value, or discard it on purpose with 'void'.
export const reportDroppedValue = (
  stmt: TypedStatement,
  code: 'T0025' | 'T0026',
  diagnostics: Diagnostics,
): void => {
  const dropped = droppedValue(stmt);
  if (dropped !== null) {
    diagnostics.error({ code, span: dropped.span, data: { actual: typeToString(dropped.type) } });
  }
};

// `loopBody` marks a fully Done-required block: a 'for'/'while' body, whose
// *last* statement is discarded by the loop too (T0026), not just its non-final
// ones (T0025). Everywhere else the last statement is a value position — its
// value flows out as the block's value — so only the non-final ones are checked.
export const inferBlock = (block: Block, env: TypeEnv, diagnostics: Diagnostics, loopBody = false): TypedBlock => {
  const inner = env.child();
  const typedStmts: TypedStatement[] = [];
  let blockType: AscentType = DONE_TYPE;

  block.stmts.forEach((stmt, i) => {
    const typedStmt = inferStmt(stmt, inner, diagnostics);
    typedStmts.push(typedStmt);
    const isLast = i === block.stmts.length - 1;
    if (!isLast) {
      reportDroppedValue(typedStmt, 'T0025', diagnostics);
    } else if (loopBody) {
      reportDroppedValue(typedStmt, 'T0026', diagnostics);
    }
    blockType = typedStmt.kind === 'expr' ? typedStmt.expr.type : DONE_TYPE;
  });

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

// The type a literal pattern compares as — evident from its own kind. Used
// both for the subject-compatibility check and as documentation of what a
// pattern's value is.
const literalPatternType = (p: LiteralPattern): AscentType => {
  switch (p.valueType) {
    case 'Int': return INT_TYPE;
    case 'Float': return FLOAT_TYPE;
    case 'Bool': return BOOL_TYPE;
    case 'String': return STRING_TYPE;
  }
};

// A stable key identifying a literal pattern's constant, so a second arm with
// the same constant is flagged unreachable (T0031). valueType is part of the
// key, so '0' (Int) and '0.0' (Float) never collide — stage 1 doesn't chase
// the cross-type numeric equality ('0 == 0.0') that '==' itself honours.
const literalPatternKey = (p: LiteralPattern): string => {
  switch (p.valueType) {
    case 'Int': return `Int:${p.value}`;
    case 'Float': return `Float:${p.value}`;
    case 'Bool': return `Bool:${p.value}`;
    case 'String': return `String:${JSON.stringify(p.value)}`;
  }
};

// A 'match' is an expression (whitepaper §5): it synthesizes the subject, then
// each arm, and its type is the join of the reachable arms' bodies (every arm
// must agree, since the whole 'match' becomes one value). Three checker rules
// ride along: a pattern must be comparable to the subject (T0028, the '=='
// rule), the arms must be exhaustive (T0029 — stage 1 needs an 'else', since no
// finite list of scalar literals covers every value), and no arm may be
// unreachable (T0031 — shadowed by an earlier 'else' or a duplicate literal).
export const inferMatch = (expr: Match, env: TypeEnv, diagnostics: Diagnostics): TypedMatch => {
  const typedSubject = synth(expr.subject, env, diagnostics);
  const subjectType = typedSubject.type;

  const typedArms: TypedMatchArm[] = [];
  const seen = new Map<string, Span>(); // literal key → the first arm that used it
  let elseSpan: Span | null = null;     // the 'else' arm's span, once one is seen

  // The reachable arms' body types, joined into the match's own type below. An
  // unreachable arm still gets synth'd (so errors inside its body surface) but
  // is left out of the join and skips the pattern-compat check — it already
  // carries its own T0031, and folding a shadowed arm in would only add noise.
  const bodyTypes: { type: AscentType; span: Span }[] = [];

  for (const arm of expr.arms) {
    const typedBody = synth(arm.body, env, diagnostics);
    typedArms.push({ pattern: arm.pattern, body: typedBody, span: arm.span });

    if (elseSpan !== null) {
      diagnostics.error({ code: 'T0031', span: arm.span, related: [{ key: 'shadow', span: elseSpan }] });
      continue;
    }

    if (arm.pattern.kind === 'elsePattern') {
      elseSpan = arm.span;
    } else {
      const key = literalPatternKey(arm.pattern);
      const firstSpan = seen.get(key);
      if (firstSpan !== undefined) {
        diagnostics.error({ code: 'T0031', span: arm.span, related: [{ key: 'shadow', span: firstSpan }] });
        continue;
      }
      seen.set(key, arm.span);

      // The pattern is compared against the subject, so it has to be a value
      // that could be equal to it — exactly the rule '==' uses (a common type
      // exists). An already-Invalid subject skips this without a second error.
      const patternType = literalPatternType(arm.pattern);
      if (!isInvalidType(subjectType) && leastCommonType(subjectType, patternType) === null) {
        diagnostics.error({
          code: 'T0028', span: arm.pattern.span,
          data: { expected: typeToString(subjectType), actual: typeToString(patternType) },
          related: [{ key: 'subject', span: expr.subject.span }],
        });
      }
    }

    bodyTypes.push({ type: typedBody.type, span: arm.span });
  }

  if (elseSpan === null) {
    diagnostics.error({ code: 'T0029', span: expr.span });
  }

  // Join the reachable arms pairwise, like a list literal's elements. On the
  // first pair with no common type, report T0030 and settle the whole match at
  // Invalid so the failure stops here instead of cascading. leastCommonType is
  // Invalid-aware, so an arm whose own body failed carries Invalid through
  // without a second diagnostic.
  let type: AscentType = DONE_TYPE;
  if (bodyTypes.length > 0) {
    type = bodyTypes[0]!.type;
    for (const arm of bodyTypes.slice(1)) {
      const ct = leastCommonType(type, arm.type);
      if (ct === null) {
        diagnostics.error({
          code: 'T0030', span: expr.span,
          data: { first: typeToString(type), other: typeToString(arm.type) },
          related: [{ key: 'arm', span: arm.span }],
        });
        type = INVALID_TYPE;
        break;
      }
      type = ct;
    }
  }

  return { kind: 'match', subject: typedSubject, arms: typedArms, type, span: expr.span };
};

export const inferStmt = (stmt: Statement, env: TypeEnv, diagnostics: Diagnostics): TypedStatement => {
  switch (stmt.kind) {
    case 'fix':
    case 'mut': {
      const annotation = stmt.typeAnnotation !== null ? typeFromExpr(stmt.typeAnnotation, env, diagnostics) : null;

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

    case 'typeDecl': {
      // A type declaration (whitepaper §6) — a record (one variant) or a tagged
      // union (several). Reject the type-name clashes first: a built-in name
      // (Int, List, …) or a name already declared.
      if (BUILTIN_TYPE_NAMES.has(stmt.name)) {
        diagnostics.error({ code: 'N0008', span: stmt.nameSpan, data: { name: stmt.name } });
      } else {
        const existing = env.getType(stmt.name);
        if (existing !== null) {
          diagnostics.error({ code: 'N0006', span: stmt.nameSpan, related: [{ key: 'declaration', span: existing.declSpan }] });
        }
      }

      // Vet each variant tag before anything is registered: a tag can't repeat
      // within this type (N0009), can't reuse a built-in type name (N0008), and
      // can't collide with a constructor another type already owns (N0010) —
      // that last check runs now, while getConstructor still sees only *other*
      // types (this one isn't registered yet). A repeated tag is dropped so the
      // rest of the type still forms.
      const tagSeen = new Map<string, typeof stmt.variants[number]>();
      const keptVariants: typeof stmt.variants = [];
      for (const variant of stmt.variants) {
        const firstTag = tagSeen.get(variant.tag);
        if (firstTag !== undefined) {
          diagnostics.error({ code: 'N0009', span: variant.tagSpan, data: { tag: variant.tag }, related: [{ key: 'declaration', span: firstTag.tagSpan }] });
          continue;
        }
        tagSeen.set(variant.tag, variant);
        // A tag equal to the type's own name (the record sugar, or the explicit
        // single-variant form) was already vetted by the type-name checks above
        // (N0008/N0006), so skip re-checking it here — it would just double-report.
        if (variant.tag !== stmt.name) {
          if (BUILTIN_TYPE_NAMES.has(variant.tag)) {
            diagnostics.error({ code: 'N0008', span: variant.tagSpan, data: { name: variant.tag } });
          } else {
            const owner = env.getConstructor(variant.tag);
            if (owner !== null && owner.info.name !== stmt.name) {
              diagnostics.error({ code: 'N0010', span: variant.tagSpan, data: { tag: variant.tag, owner: owner.info.name }, related: [{ key: 'declaration', span: owner.info.declSpan }] });
            }
          }
        }
        keptVariants.push(variant);
      }

      // Register the name up front (fieldless, for now) so a field may refer to
      // the type being declared — 'type Node = { next: Node? }' resolves 'Node',
      // and a union variant's field may reference its own type just the same.
      env.setType({ name: stmt.name, variants: keptVariants.map(v => ({ tag: v.tag, fields: [] })), declSpan: stmt.nameSpan });

      // Form each variant's fields, deduping names *within* the variant (N0007
      // is per-variant — two variants may share a field name).
      const variants: Variant[] = keptVariants.map((variant) => {
        const fields: RecordField[] = [];
        const seen = new Map<string, typeof variant.fields[number]>();
        for (const field of variant.fields) {
          const first = seen.get(field.name);
          if (first !== undefined) {
            diagnostics.error({ code: 'N0007', span: field.nameSpan, data: { name: field.name }, related: [{ key: 'declaration', span: first.nameSpan }] });
            continue;
          }
          seen.set(field.name, field);
          fields.push({ name: field.name, type: typeFromExpr(field.type, env, diagnostics), span: field.span });
        }
        return { tag: variant.tag, fields };
      });

      // Re-register with the completed variants (the placeholder above only
      // existed so self-referential fields could resolve mid-formation).
      env.setType({ name: stmt.name, variants, declSpan: stmt.nameSpan });

      const typedVariants: TypedVariantDecl[] = variants.map(v => ({ tag: v.tag, fields: v.fields.map(f => ({ name: f.name, type: f.type })) }));
      return { kind: 'typeDecl', name: stmt.name, variants: typedVariants, span: stmt.span };
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
      const typedBody = inferBlock(stmt.body, env, diagnostics, true);
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
      const typedBody = inferBlock(stmt.body, inner, diagnostics, true);
      return { kind: 'for', name: stmt.name, elemType, iterable: typedIterable, body: typedBody, span: stmt.span };
    }

    case 'expr': {
      return { kind: 'expr', expr: synth(stmt.expr, env, diagnostics), span: stmt.span };
    }

    case 'void': {
      // 'void expr' discards a real value on purpose. A Done-typed operand has
      // no value to discard (T0027) — an already-effectful 'print' or loop
      // needs no 'void'. Invalid/Never already carry their own story, so stay
      // quiet there. The statement itself always yields Done.
      const typedExpr = synth(stmt.expr, env, diagnostics);
      if (typedExpr.type.kind === 'Done') {
        diagnostics.error({ code: 'T0027', span: stmt.expr.span });
      }
      return { kind: 'void', expr: typedExpr, span: stmt.span };
    }
  }
};
