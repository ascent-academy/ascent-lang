import type { Statement, Block, If, Match, LiteralPattern, BindTarget, FieldPattern } from '../parser/ast.js';
import type { Span } from '../lexer/token.js';
import type { TypedBlock, TypedIf, TypedMatch, TypedMatchArm, TypedExpr, TypedStatement, TypedFieldPattern, TypedBindTarget } from '../parser/typed-ast.js';
import { AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, NONE_TYPE, DONE_TYPE, NEVER_TYPE, INVALID_TYPE, isInvalidType, containsNever, typeToString, leastCommonType, isAssignableTo, namedType, functionType } from '../types/types.js';
import type { TypeEnv, RecordField, Variant } from './env.js';
import type { TypedVariantDecl } from '../parser/typed-ast.js';
import { Diagnostics } from './diagnostics.js';
import { typeFromExpr, BUILTIN_TYPE_NAMES } from './formation.js';
import { synth } from './synth.js';
import { check } from './check.js';

// The built-in type names (formation.ts) are what a 'type' declaration can't
// redeclare (N0008). None/Done/True/False aren't among them: they lex as value
// constructors, never TYPE_NAME, so they can't reach a type-name position.

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
  // A statement that diverges (type Never — a 'return', §7) leaves the block
  // before its end, so everything after it is unreachable and the block as a
  // whole diverges. Track that: the block's value type becomes Never, which is
  // what lets 'fn() -> Int { return 5; … }' (or a branch that returns) satisfy
  // its declared type instead of being judged by the unreachable trailing value.
  let diverged = false;

  block.stmts.forEach((stmt, i) => {
    const typedStmt = inferStmt(stmt, inner, diagnostics);
    typedStmts.push(typedStmt);
    const isLast = i === block.stmts.length - 1;
    if (!isLast) {
      reportDroppedValue(typedStmt, 'T0025', diagnostics);
    } else if (loopBody) {
      reportDroppedValue(typedStmt, 'T0026', diagnostics);
    }
    const stmtType = typedStmt.kind === 'expr' ? typedStmt.expr.type : DONE_TYPE;
    if (!diverged) blockType = stmtType;
    if (stmtType.kind === 'Never') diverged = true;
  });

  return { kind: 'block', stmts: typedStmts, type: diverged ? NEVER_TYPE : blockType, span: block.span };
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
// must agree, since the whole 'match' becomes one value). The checker rules that
// ride along: a pattern must be comparable to the subject (T0028 — a literal of
// a compatible scalar type, or a variant of the subject's own union, both being
// "a common type exists"); a variant pattern binds a subset of its variant's
// fields into the arm's body (T0019/T0020 on an unknown or repeated field);
// the arms must be exhaustive (list every variant of a union subject, or supply
// an 'else' — a missing variant is T0034, a non-union subject with no 'else' is
// T0029); and no arm may be unreachable (T0031 — after an 'else', or a repeat of
// an earlier literal/variant).
export const inferMatch = (expr: Match, env: TypeEnv, diagnostics: Diagnostics): TypedMatch => {
  const typedSubject = synth(expr.subject, env, diagnostics);
  const subjectType = typedSubject.type;

  const typedArms: TypedMatchArm[] = [];
  const seen = new Map<string, Span>();      // literal/variant pattern key → its first arm
  let elseSpan: Span | null = null;          // the 'else' arm's span, once one is seen
  let noneSpan: Span | null = null;          // a 'None' arm's span (Optional's absent case)
  let presentSpan: Span | null = null;       // a binding arm's span (Optional's present catch-all)
  const coveredTags = new Set<string>();     // union variant tags a reachable arm handles

  // A pattern that matches a *present* value (never None): a literal, a variant,
  // or a binding. Used for reachability — such a pattern after a binding (which
  // already catches every present value) is unreachable.
  const matchesPresent = (k: string): boolean =>
    k === 'litPattern' || k === 'variantPattern' || k === 'bindingPattern';

  // The reachable arms' body types, joined into the match's own type below. An
  // unreachable arm still gets synth'd (so errors inside its body surface) but
  // is left out of the join — it already carries its own T0031, and folding a
  // shadowed arm in would only add noise.
  const bodyTypes: { type: AscentType; span: Span }[] = [];

  for (const arm of expr.arms) {
    // Set up the arm's scope and its pattern's type before synthing the body, so
    // a variant/binding pattern's bound name(s) are in scope inside it.
    // `patternType` is what the pattern compares as (null for 'else'/a binding,
    // which match without a value comparison).
    const pat = arm.pattern;
    let armEnv: TypeEnv = env;
    let patternType: AscentType | null = null;
    let key: string | null = null;
    if (pat.kind === 'litPattern') {
      patternType = literalPatternType(pat);
      key = literalPatternKey(pat);
    } else if (pat.kind === 'variantPattern') {
      armEnv = env.child();
      key = `variant:${pat.tag}`;
      const ctor = env.getConstructor(pat.tag);
      if (ctor === null) {
        // The tag names no declared constructor — an unknown name, the same
        // mistake as an unknown type in construction (N0005). Its fields still
        // bind (as Invalid) so the body doesn't cascade into N0001.
        diagnostics.error({ code: 'N0005', span: pat.tagSpan, data: { name: pat.tag } });
        bindPatternFields(pat.fields, null, armEnv, 'fix', pat.tag, diagnostics);
        patternType = INVALID_TYPE;
      } else {
        // The pattern's type is the whole union the tag belongs to — so matching
        // 'Circle' against a 'Shape' agrees, but against a 'Color' is T0028.
        bindPatternFields(pat.fields, ctor.variant, armEnv, 'fix', pat.tag, diagnostics);
        patternType = namedType(ctor.info.name);
      }
    } else if (pat.kind === 'nonePattern') {
      // 'None' compares as the None type, so the ordinary T0028 check accepts it
      // on a T? subject (None widens into T?) and rejects it on any other.
      patternType = NONE_TYPE;
    } else if (pat.kind === 'bindingPattern') {
      armEnv = env.child();
      // The present value of an Optional, narrowed to its element type T
      // (whitepaper §7). On a non-Optional subject a name pattern is meaningless
      // (T0041) — 'else' is the way to catch any value. Bind the name either way
      // (as T, or Invalid) so the arm body doesn't cascade into N0001.
      let boundType: AscentType = INVALID_TYPE;
      if (subjectType.kind === 'Optional') {
        boundType = subjectType.elem;
      } else if (!isInvalidType(subjectType)) {
        diagnostics.error({
          code: 'T0041', span: pat.span,
          data: { actual: typeToString(subjectType) },
          related: [{ key: 'subject', span: expr.subject.span }],
        });
      }
      armEnv.set(pat.name, boundType, 'fix', pat.nameSpan);
    }

    const typedBody = synth(arm.body, armEnv, diagnostics);
    typedArms.push({ pattern: pat, body: typedBody, span: arm.span });

    // Reachability: is this arm already covered by an earlier catch-all? A prior
    // 'else' covers everything; None + a binding together cover an Optional
    // entirely; a binding alone catches every present value.
    let shadowSpan: Span | null = null;
    if (elseSpan !== null) {
      shadowSpan = elseSpan;
    } else if (noneSpan !== null && presentSpan !== null) {
      shadowSpan = presentSpan;                                 // Optional fully covered
    } else if (presentSpan !== null && matchesPresent(pat.kind)) {
      shadowSpan = presentSpan;                                 // a present value after the catch-all
    } else if (noneSpan !== null && pat.kind === 'nonePattern') {
      shadowSpan = noneSpan;                                    // a repeated 'None'
    }
    if (shadowSpan !== null) {
      diagnostics.error({ code: 'T0031', span: arm.span, related: [{ key: 'shadow', span: shadowSpan }] });
      continue;
    }

    // Record what this arm covers, and catch repeated literals/variants.
    if (pat.kind === 'elsePattern') {
      elseSpan = arm.span;
    } else if (pat.kind === 'nonePattern') {
      noneSpan = arm.span;
    } else if (pat.kind === 'bindingPattern') {
      presentSpan = arm.span;
    } else {
      const firstSpan = seen.get(key!);
      if (firstSpan !== undefined) {
        diagnostics.error({ code: 'T0031', span: arm.span, related: [{ key: 'shadow', span: firstSpan }] });
        continue;
      }
      seen.set(key!, arm.span);
      if (pat.kind === 'variantPattern') coveredTags.add(pat.tag);
    }

    // The pattern is compared against the subject, so it has to be something the
    // subject could be — the same "a common type exists" rule '==' uses. An
    // already-Invalid subject or pattern is absorbed without a second error.
    if (!isInvalidType(subjectType) && patternType !== null && leastCommonType(subjectType, patternType) === null) {
      diagnostics.error({
        code: 'T0028', span: pat.span,
        data: { expected: typeToString(subjectType), actual: typeToString(patternType) },
        related: [{ key: 'subject', span: expr.subject.span }],
      });
    }

    bodyTypes.push({ type: typedBody.type, span: arm.span });
  }

  // Exhaustiveness (whitepaper §5): a 'match' must handle every case, listing
  // them or supplying an 'else'. A *finite* domain is exhausted by its own
  // patterns with no 'else' needed — Bool by True and False, a union by all its
  // tags (design.md §2 treats Bool as the union True | False). An *infinite*
  // domain (Int/Float/String/List/Range) can't be, so it needs an 'else'
  // (T0029). An Optional adds the None case on top of its element's domain
  // (T0042): a 'Bool?' is exhausted by True/False/None, while an 'Int?' still
  // needs a binding (or 'else') for its infinite present side. `domainOf` gives a
  // type's finite case set and which cases are still uncovered, or null when the
  // type is infinite. An 'else' satisfies everything; an Invalid subject is quiet.
  const domainOf = (type: AscentType): { label: string; all: string[]; missing: string[] } | null => {
    if (type.kind === 'Bool') {
      const cases: [string, string][] = [['True', 'Bool:true'], ['False', 'Bool:false']];
      return { label: 'Bool', all: cases.map(([c]) => c), missing: cases.filter(([, k]) => !seen.has(k)).map(([c]) => c) };
    }
    if (type.kind === 'Named') {
      const info = env.getType(type.name);
      if (info === null) return null;
      const all = info.variants.map(v => v.tag);
      return { label: info.name, all, missing: all.filter(tag => !coveredTags.has(tag)) };
    }
    return null;
  };

  if (elseSpan === null) {
    if (subjectType.kind === 'Optional') {
      const missing: string[] = [];
      if (noneSpan === null) missing.push('None');
      if (presentSpan === null) {
        // The present side isn't caught by a binding — a finite element domain
        // can still be fully covered by its own patterns; an infinite one can't.
        const domain = domainOf(subjectType.elem);
        if (domain === null) missing.push('a value');
        else missing.push(...domain.missing);
      }
      if (missing.length > 0) {
        diagnostics.error({ code: 'T0042', span: expr.span, data: { type: typeToString(subjectType), missing: missing.join(' and ') } });
      }
    } else {
      const domain = domainOf(subjectType);
      if (domain === null) {
        if (!isInvalidType(subjectType)) diagnostics.error({ code: 'T0029', span: expr.span });
      } else if (domain.missing.length > 0) {
        diagnostics.error({
          code: 'T0034', span: expr.span,
          data: { type: domain.label, variants: domain.all.join(', '), missing: domain.missing.join(', ') },
        });
      }
    }
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

// Bind a record/variant pattern's named fields into `env` as fixed locals,
// resolving each against `variant`'s declared fields (whitepaper §5). Shared by
// fix/mut destructuring and match variant patterns — the same field syntax in
// both. A field the variant doesn't declare is T0019 (bound Invalid, so later
// uses stay quiet instead of cascading); a field named twice is T0020 (the
// repeat is dropped). `variant` is null when the tag couldn't be resolved —
// then every field binds Invalid. `origin` is 'fix'/'mut' so a bound local
// carries the right reassignment rule (match arms bind as 'fix').
const bindPatternFields = (
  fields: FieldPattern[], variant: Variant | null, env: TypeEnv,
  origin: 'fix' | 'mut', typeName: string, diagnostics: Diagnostics,
): TypedFieldPattern[] => {
  const typed: TypedFieldPattern[] = [];
  const seen = new Map<string, Span>();
  for (const f of fields) {
    if (seen.has(f.field)) {
      diagnostics.error({ code: 'T0020', span: f.fieldSpan, data: { field: f.field, type: typeName } });
      continue;
    }
    seen.set(f.field, f.fieldSpan);

    let fieldType: AscentType = INVALID_TYPE;
    if (variant !== null) {
      const decl = variant.fields.find(d => d.name === f.field);
      if (decl === undefined) {
        diagnostics.error({ code: 'T0019', span: f.fieldSpan, data: { field: f.field, type: typeName } });
      } else {
        fieldType = decl.type;
      }
    }
    env.set(f.bind, fieldType, origin, f.bindSpan);
    typed.push({ field: f.field, bind: f.bind, type: fieldType });
  }
  return typed;
};

// Resolve a record destructuring pattern (whitepaper §5) and bind its fields
// into `env`. The tag must name an *irrefutable* single-variant record — a value
// of it is always that one shape, so the destructuring can't fail. A refutable
// tag (a case of a multi-variant union) might not match, so it's rejected (T0033)
// and belongs in a 'match' instead; an unknown tag is N0005, a built-in N0012.
// Returns `recordType` (the type the bound value must have — a real Named type
// only when the destructuring is sound, else Invalid) plus the typed fields.
// Shared by a fix/mut declaration and a 'for' loop's variable, which then check
// their own source (an init, or the iterable's elements) against `recordType`.
const resolveRecordTarget = (
  target: Extract<BindTarget, { kind: 'record' }>,
  env: TypeEnv,
  origin: 'fix' | 'mut',
  diagnostics: Diagnostics,
): { recordType: AscentType; typedFields: TypedFieldPattern[] } => {
  // `variant` is the field set to bind against — kept even on a refutable tag,
  // whose fields are still real, so downstream uses of the bound locals don't
  // cascade into N0001.
  const ctor = env.getConstructor(target.typeName);
  let variant: Variant | null = null;
  let recordType: AscentType = INVALID_TYPE;
  if (ctor !== null) {
    if (ctor.info.variants.length === 1) {
      variant = ctor.variant;
      recordType = namedType(ctor.info.name);
    } else {
      // A union case: it might not match, so it can't be destructured in a
      // binding — 'match' handles each case instead.
      diagnostics.error({
        code: 'T0033', span: target.typeNameSpan,
        data: { type: ctor.info.name, variants: ctor.info.variants.map(v => v.tag).join(', ') },
      });
      variant = ctor.variant;
    }
  } else {
    const asType = env.getType(target.typeName);
    if (asType !== null) {
      // The union's *type name* written as a pattern — refutable for the same
      // reason: a value of it could be any of its variants.
      diagnostics.error({
        code: 'T0033', span: target.typeNameSpan,
        data: { type: asType.name, variants: asType.variants.map(v => v.tag).join(', ') },
      });
    } else if (BUILTIN_TYPE_NAMES.has(target.typeName)) {
      diagnostics.error({ code: 'N0012', span: target.typeNameSpan, data: { name: target.typeName } });
    } else {
      diagnostics.error({ code: 'N0005', span: target.typeNameSpan, data: { name: target.typeName } });
    }
  }

  // Bind each named field to a local (T0019/T0020 on an unknown or repeated
  // field), of its declared type when the variant is known.
  const typedFields = bindPatternFields(target.fields, variant, env, origin, target.typeName, diagnostics);
  return { recordType, typedFields };
};

// A 'fix'/'mut' whose target is a record destructuring pattern — the init must
// have the pattern's record type (whitepaper §5).
const inferRecordBinding = (
  stmt: Extract<Statement, { kind: 'fix' | 'mut' }>,
  target: Extract<BindTarget, { kind: 'record' }>,
  env: TypeEnv,
  diagnostics: Diagnostics,
): TypedStatement => {
  const { recordType, typedFields } = resolveRecordTarget(target, env, stmt.kind, diagnostics);

  // Check the init against the pattern's record type. On an error path
  // recordType is Invalid — synth the init directly so its own errors still
  // surface, but demand nothing of it (Invalid absorbs the comparison).
  const typedInit = isInvalidType(recordType)
    ? synth(stmt.init, env, diagnostics)
    : check(stmt.init, recordType, env, diagnostics, [{ key: 'annotation', span: target.typeNameSpan }]);

  return {
    kind: stmt.kind,
    target: { kind: 'record', typeName: target.typeName, fields: typedFields },
    typeAnnotation: null,
    slotType: recordType,
    init: typedInit,
    span: stmt.span,
  };
};

export const inferStmt = (stmt: Statement, env: TypeEnv, diagnostics: Diagnostics): TypedStatement => {
  switch (stmt.kind) {
    case 'fix':
    case 'mut': {
      if (stmt.target.kind === 'record') {
        return inferRecordBinding(stmt, stmt.target, env, diagnostics);
      }
      const name = stmt.target.name;
      const annotation = stmt.typeAnnotation !== null ? typeFromExpr(stmt.typeAnnotation, env, diagnostics) : null;

      // Recursive 'fix'/'mut': the name is in scope within its own initializer
      // (the recursive-let rule, §5). When the initializer is a function
      // literal, its type is fully known from the signature (or the annotation)
      // without checking the body, so bind the name *first* — a self-reference
      // in the body then resolves to it. The final env.set below overwrites this
      // with the identical formed type. (An eager, non-function self-reference
      // like 'fix x = x + 1' is the "used before initialized" case — still
      // reported as N0001 by the slot lookup, an acceptable Stage-1 message.)
      if (stmt.init.kind === 'fn') {
        // Form the signature type quietly here — the real diagnostics for any
        // bad type name in the signature surface when the init is checked below,
        // so a throwaway sink avoids double-reporting them.
        const preType = annotation ?? functionType(
          stmt.init.params.map(p => typeFromExpr(p.type, env, new Diagnostics())),
          typeFromExpr(stmt.init.returnType, env, new Diagnostics()),
        );
        env.set(name, preType, stmt.kind, stmt.span);
      }

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

      env.set(name, slotType, stmt.kind, stmt.span);

      return {
        kind: stmt.kind,
        target: { kind: 'name', name },
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
      let target: TypedBindTarget;
      if (stmt.target.kind === 'record') {
        // A destructuring loop: each element is pulled apart as the pattern's
        // (single-variant) record. The element type must be that record — a
        // 'for Car{ … } in people' where the elements are Person is T0001, the
        // same mismatch a 'fix Car{ … } = aPerson' would be. Refutable/unknown
        // tags are handled inside resolveRecordTarget (T0033/N0005/N0012).
        const { recordType, typedFields } = resolveRecordTarget(stmt.target, inner, 'fix', diagnostics);
        if (!isInvalidType(recordType) && !isInvalidType(elemType) && !isAssignableTo(elemType, recordType)) {
          diagnostics.error({
            code: 'T0001', span: stmt.iterable.span,
            data: { expected: typeToString(recordType), actual: typeToString(elemType) },
            related: [{ key: 'annotation', span: stmt.target.typeNameSpan }],
          });
        }
        target = { kind: 'record', typeName: stmt.target.typeName, fields: typedFields };
      } else {
        inner.set(stmt.target.name, elemType, 'fix', stmt.target.nameSpan);
        target = { kind: 'name', name: stmt.target.name };
      }
      const typedBody = inferBlock(stmt.body, inner, diagnostics, true);
      return { kind: 'for', target, elemType, iterable: typedIterable, body: typedBody, span: stmt.span };
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
