import type { Statement, Block, If, Match, LiteralPattern, BindTarget, FieldPattern } from '../parser/ast.js';
import type { Span } from '../lexer/token.js';
import type { TypedBlock, TypedIf, TypedMatch, TypedMatchArm, TypedExpr, TypedStatement, TypedFieldPattern, TypedBindTarget } from '../parser/typed-ast.js';
import { AscentType, INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, NONE_TYPE, DONE_TYPE, NEVER_TYPE, INVALID_TYPE, isInvalidType, containsNever, containsBareNone, typeToString, leastCommonType, joinTypes, isAssignableTo, namedType, functionType } from '../types/types.js';
import type { TypeEnv, RecordField, Variant } from './env.js';
import type { TypedVariantDecl } from '../parser/typed-ast.js';
import { Diagnostics } from './diagnostics.js';
import { typeFromExpr, BUILTIN_TYPE_NAMES } from './formation.js';
import { synth } from './synth.js';
import { check } from './check.js';
import { MODULE_SIGS } from './stdlib.js';
import { iterableElement } from './traits.js';

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

// Report the drop, if any: T0057 when a *following statement* discards it,
// T0058 when a *loop* discards it each pass. The fix for both is the same —
// consume the value, or discard it on purpose with 'void'.
export const reportDroppedValue = (
  stmt: TypedStatement,
  code: 'T0057' | 'T0058',
  diagnostics: Diagnostics,
): void => {
  const dropped = droppedValue(stmt);
  if (dropped !== null) {
    diagnostics.error({ code, span: dropped.span, data: { actual: typeToString(dropped.type) } });
  }
};

// `loopBody` marks a fully Done-required block: a 'for'/'while' body, whose
// *last* statement is discarded by the loop too (T0058), not just its non-final
// ones (T0057). Everywhere else the last statement is a value position — its
// value flows out as the block's value — so only the non-final ones are checked.
export const inferBlock = (block: Block, env: TypeEnv, diagnostics: Diagnostics, loopBody = false): TypedBlock => {
  const inner = env.child();
  const typedStmts: TypedStatement[] = [];
  let blockType: AscentType = DONE_TYPE;
  // A statement that diverges (type Never — a 'return', §7) leaves the block
  // before its end, so everything after it is unreachable and the block as a
  // whole diverges. Track that: the block's value type becomes Never, which is
  // what lets 'fn(): Int { return 5; … }' (or a branch that returns) satisfy
  // its declared type instead of being judged by the unreachable trailing value.
  let diverged = false;

  block.stmts.forEach((stmt, i) => {
    const typedStmt = inferStmt(stmt, inner, diagnostics);
    typedStmts.push(typedStmt);
    const isLast = i === block.stmts.length - 1;
    if (!isLast) {
      reportDroppedValue(typedStmt, 'T0057', diagnostics);
    } else if (loopBody) {
      reportDroppedValue(typedStmt, 'T0058', diagnostics);
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
  // below (T0009 and T0010 inspect different things and stay independent).
  if (!isInvalidType(typedCond.type) && typedCond.type.kind !== 'Bool') {
    diagnostics.error({ code: 'T0009', span: expr.cond.span, data: { actual: typeToString(typedCond.type) } });
  }

  const typedThen = inferBlock(expr.then, env, diagnostics);

  if (expr.else === null) {
    return { kind: 'if', cond: typedCond, then: typedThen, else: null, type: DONE_TYPE, span: expr.span };
  }

  const typedElse: TypedBlock | TypedIf = expr.else.kind === 'if'
    ? inferIf(expr.else, env, diagnostics)
    : inferBlock(expr.else, env, diagnostics);

  // The branches join like a list's elements — a value and an optional fold into
  // an optional ('if (c) { None } else { 5 }' is 'Int?'), so joinTypes, not the
  // strict leastCommonType.
  const ct = joinTypes(typedThen.type, typedElse.type);
  if (ct === null) {
    diagnostics.error({
      code: 'T0010', span: expr.span,
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
// the same constant is flagged unreachable (T0033). valueType is part of the
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
// ride along: a pattern must be comparable to the subject (T0029 — a literal of
// a compatible scalar type, or a variant of the subject's own union, both being
// "a common type exists"); a variant pattern binds a subset of its variant's
// fields into the arm's body (T0023/T0024 on an unknown or repeated field);
// the arms must be exhaustive (list every variant of a union subject, or supply
// an 'else' — a missing variant is T0031, a non-union subject with no 'else' is
// T0030); and no arm may be unreachable (T0033 — after an 'else', or a repeat of
// an earlier literal/variant).
export const inferMatch = (expr: Match, env: TypeEnv, diagnostics: Diagnostics): TypedMatch => {
  const typedSubject = synth(expr.subject, env, diagnostics);
  const subjectType = typedSubject.type;

  const typedArms: TypedMatchArm[] = [];
  const seen = new Map<string, Span>();      // literal/variant pattern key → its first arm
  let noneSpan: Span | null = null;          // a 'None' arm (Optional's absent case)
  let catchAllSpan: Span | null = null;      // the one catch-all — an 'else' or a binding
  const coveredTags = new Set<string>();     // union variant tags a listed arm handles

  // The finite set of cases a type's value can take, and which are still
  // uncovered by the arms seen so far — or null when the type is *infinite*
  // (Int/Float/String/List/Range), which no finite list of patterns can exhaust.
  // Bool is finite (True | False) and a union is finite in its tags (design.md §2
  // treats Bool as the union True | False). Reads `seen`/`coveredTags`, so it
  // reflects coverage at the point it is called.
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
    // A Result is a two-case union — 'Success' | 'Failure' (whitepaper §9) — so
    // it's finite exactly like a user union: covered by listing both cases.
    if (type.kind === 'Result') {
      const all = ['Success', 'Failure'];
      return { label: typeToString(type), all, missing: all.filter(tag => !coveredTags.has(tag)) };
    }
    return null;
  };

  // True when every case the subject can take is already listed — the *residual*
  // (whitepaper §5) is empty, so a catch-all here would match nothing (its
  // residual narrows to Never) and is dead. Only a finite domain reaches this: an
  // Optional when None *and* its element's finite cases are all listed, a plain
  // finite type when its own cases are. An infinite domain never does, so a
  // catch-all there is always legal.
  const residualEmpty = (): boolean => {
    if (subjectType.kind === 'Optional') {
      const d = domainOf(subjectType.elem);
      return noneSpan !== null && d !== null && d.missing.length === 0;
    }
    const d = domainOf(subjectType);
    return d !== null && d.missing.length === 0;
  };

  // The reachable arms' body types, joined into the match's own type below. An
  // unreachable arm still gets synth'd (so errors inside its body surface) but
  // is left out of the join — it already carries its own T0033, and folding a
  // shadowed arm in would only add noise.
  const bodyTypes: { type: AscentType; span: Span }[] = [];

  for (const arm of expr.arms) {
    // Set up the arm's scope and its pattern's type before synthing the body, so
    // a variant/binding pattern's bound name(s) are in scope inside it.
    // `patternType` is what the pattern compares as (null for a catch-all, which
    // matches without a value comparison).
    const pat = arm.pattern;
    let armEnv: TypeEnv = env;
    let patternType: AscentType | null = null;
    let key: string | null = null;
    if (pat.kind === 'litPattern') {
      patternType = literalPatternType(pat);
      key = literalPatternKey(pat);
    } else if (pat.kind === 'variantPattern' && (pat.tag === 'Success' || pat.tag === 'Failure')) {
      // The two built-in Result cases (whitepaper §9). 'Success{ value }' binds
      // 'value' at the subject's ok type, 'Failure{ error }' binds 'error' at its
      // err type. On a non-Result subject the pattern can't fit (T0029 below); its
      // fields still bind Invalid so the body doesn't cascade.
      armEnv = env.child();
      key = `variant:${pat.tag}`;
      const isResult = subjectType.kind === 'Result';
      const fieldName = pat.tag === 'Success' ? 'value' : 'error';
      const fieldType = subjectType.kind === 'Result'
        ? (pat.tag === 'Success' ? subjectType.ok : subjectType.err)
        : INVALID_TYPE;
      bindPatternFields(pat.fields, { tag: pat.tag, fields: [{ name: fieldName, type: fieldType, span: pat.tagSpan }] }, armEnv, 'fix', pat.tag, diagnostics);
      if (isResult) {
        // Matches when the subject is that same Result — the generic T0029 check
        // below compares them and agrees.
        patternType = subjectType;
      } else if (!isInvalidType(subjectType)) {
        // A Result case can only match a Result. Reported here with a clean name
        // rather than through the generic check (whose {actual} would be the odd
        // 'Never orfail Never' of the stand-in Result type).
        patternType = null;
        diagnostics.error({
          code: 'T0029', span: pat.span,
          data: { expected: typeToString(subjectType), actual: `a Result ('${pat.tag}')` },
          related: [{ key: 'subject', span: expr.subject.span }],
        });
      }
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
        // 'Circle' against a 'Shape' agrees, but against a 'Color' is T0029.
        bindPatternFields(pat.fields, ctor.variant, armEnv, 'fix', pat.tag, diagnostics);
        patternType = namedType(ctor.info.name);
      }
    } else if (pat.kind === 'nonePattern') {
      // 'None' compares as the None type, so the ordinary T0029 check accepts it
      // on a T? subject (None widens into T?) and rejects it on any other.
      patternType = NONE_TYPE;
    } else if (pat.kind === 'bindingPattern') {
      // A bare name is a *catch-all that binds the residual* (whitepaper §5). Its
      // type is that residual: for a T? whose None case a prior arm already took,
      // it is the narrowed element T (§7); otherwise the whole subject (a T? with
      // None still in play — the name may itself be None — or any other type). Its
      // last-ness / reachability is handled below alongside 'else'.
      armEnv = env.child();
      const boundType = subjectType.kind === 'Optional' && noneSpan !== null
        ? subjectType.elem
        : subjectType;
      armEnv.set(pat.name, boundType, 'fix', pat.nameSpan);
    }

    const typedBody = synth(arm.body, armEnv, diagnostics);
    typedArms.push({ pattern: pat, body: typedBody, span: arm.span });

    // Reachability. A catch-all is last (whitepaper §5), so any arm after one is
    // dead — this one check also enforces "at most one catch-all" (a second is
    // just an arm after the first).
    if (catchAllSpan !== null) {
      diagnostics.error({ code: 'T0033', span: arm.span, related: [{ key: 'shadow', span: catchAllSpan }] });
      continue;
    }

    if (pat.kind === 'elsePattern' || pat.kind === 'bindingPattern') {
      // A catch-all whose residual is already empty (every case listed above)
      // matches nothing — dead code (whitepaper §5: its residual is Never). A
      // finite domain listed in full forbids a masking catch-all, which is what
      // makes adding a variant later re-trigger the exhaustiveness check. No
      // `related` span: there's no single shadowing arm — the arms *together*
      // cover everything.
      if (residualEmpty()) {
        diagnostics.error({ code: 'T0033', span: arm.span });
      } else {
        bodyTypes.push({ type: typedBody.type, span: arm.span });
      }
      catchAllSpan = arm.span;   // it is still the catch-all: anything after is dead
      continue;
    }

    // A specific pattern (None / literal / variant): reject a repeat, then record
    // what it covers.
    if (pat.kind === 'nonePattern') {
      if (noneSpan !== null) {
        diagnostics.error({ code: 'T0033', span: arm.span, related: [{ key: 'shadow', span: noneSpan }] });
        continue;
      }
      noneSpan = arm.span;
    } else {
      const firstSpan = seen.get(key!);
      if (firstSpan !== undefined) {
        diagnostics.error({ code: 'T0033', span: arm.span, related: [{ key: 'shadow', span: firstSpan }] });
        continue;
      }
      seen.set(key!, arm.span);
      if (pat.kind === 'variantPattern') coveredTags.add(pat.tag);
    }

    // The pattern must be something the subject could be — the '==' rule (a
    // common type exists). Invalid on either side is absorbed quietly.
    if (!isInvalidType(subjectType) && patternType !== null && leastCommonType(subjectType, patternType) === null) {
      diagnostics.error({
        code: 'T0029', span: pat.span,
        data: { expected: typeToString(subjectType), actual: typeToString(patternType) },
        related: [{ key: 'subject', span: expr.subject.span }],
      });
    }

    bodyTypes.push({ type: typedBody.type, span: arm.span });
  }

  // Exhaustiveness (whitepaper §5): with no catch-all, the subject's every case
  // must be listed. An infinite domain (Int/Float/String/…) can't be, so it needs
  // a catch-all outright (T0030). A finite one is covered by listing its cases —
  // every variant of a union or Bool's True/False (T0031). An Optional adds the
  // None case on top of its element's domain (T0046): a 'Bool?' is exhausted by
  // True/False/None, while an 'Int?' still needs a catch-all for its infinite
  // present side. A catch-all satisfies everything; an Invalid subject is quiet.
  if (catchAllSpan === null) {
    if (subjectType.kind === 'Optional') {
      const missing: string[] = [];
      if (noneSpan === null) missing.push('None');
      const d = domainOf(subjectType.elem);
      if (d === null) missing.push('a value');
      else missing.push(...d.missing);
      if (missing.length > 0) {
        diagnostics.error({ code: 'T0046', span: expr.span, data: { type: typeToString(subjectType), missing: missing.join(' and ') } });
      }
    } else {
      const d = domainOf(subjectType);
      if (d === null) {
        if (!isInvalidType(subjectType)) diagnostics.error({ code: 'T0030', span: expr.span });
      } else if (d.missing.length > 0) {
        diagnostics.error({
          code: 'T0031', span: expr.span,
          data: { type: d.label, variants: d.all.join(', '), missing: d.missing.join(', ') },
        });
      }
    }
  }

  // Join the reachable arms pairwise, like a list literal's elements (joinTypes,
  // so a value arm and a None arm fold into an optional). On the first pair with
  // no common type, report T0032 and settle the whole match at Invalid so the
  // failure stops here instead of cascading. joinTypes is Invalid-aware, so an
  // arm whose own body failed carries Invalid through without a second diagnostic.
  let type: AscentType = DONE_TYPE;
  if (bodyTypes.length > 0) {
    type = bodyTypes[0]!.type;
    for (const arm of bodyTypes.slice(1)) {
      const ct = joinTypes(type, arm.type);
      if (ct === null) {
        diagnostics.error({
          code: 'T0032', span: expr.span,
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
// both. A field the variant doesn't declare is T0023 (bound Invalid, so later
// uses stay quiet instead of cascading); a field named twice is T0024 (the
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
      diagnostics.error({ code: 'T0024', span: f.fieldSpan, data: { field: f.field, type: typeName } });
      continue;
    }
    seen.set(f.field, f.fieldSpan);

    let fieldType: AscentType = INVALID_TYPE;
    if (variant !== null) {
      const decl = variant.fields.find(d => d.name === f.field);
      if (decl === undefined) {
        diagnostics.error({ code: 'T0023', span: f.fieldSpan, data: { field: f.field, type: typeName } });
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
// tag (a case of a multi-variant union) might not match, so it's rejected (T0034)
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
  // 'Success'/'Failure' are the built-in Result cases — refutable, since a
  // Result could be either — so, like a union variant, they can't be pulled
  // apart in a 'fix'/'mut' binding; 'match' handles both cases (whitepaper §9).
  if (target.typeName === 'Success' || target.typeName === 'Failure') {
    diagnostics.error({ code: 'T0034', span: target.typeNameSpan, data: { type: 'Result', variants: 'Success, Failure' } });
    const typedFields = bindPatternFields(target.fields, null, env, origin, target.typeName, diagnostics);
    return { recordType: INVALID_TYPE, typedFields };
  }

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
        code: 'T0034', span: target.typeNameSpan,
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
        code: 'T0034', span: target.typeNameSpan,
        data: { type: asType.name, variants: asType.variants.map(v => v.tag).join(', ') },
      });
    } else if (BUILTIN_TYPE_NAMES.has(target.typeName)) {
      diagnostics.error({ code: 'N0012', span: target.typeNameSpan, data: { name: target.typeName } });
    } else {
      diagnostics.error({ code: 'N0005', span: target.typeNameSpan, data: { name: target.typeName } });
    }
  }

  // Bind each named field to a local (T0023/T0024 on an unknown or repeated
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
          stmt.init.async,
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
        } else if (containsBareNone(typedInit.type)) {
          // design.md §7's slot-inference wrinkle: a bare 'None' carries no
          // type information (there's nothing to widen it to) — so it needs a
          // written annotation too. This fires for a lone 'None' *and* for a
          // list of nothing but it ('[None]' → List<None>), which freezes the
          // slot's element type the same dead-end way — but not for a real
          // Optional ('String?' from '.first()', 'List<Int?>'), whose None is
          // the legitimate absent case.
          diagnostics.error({ code: 'T0002', span: stmt.init.span });
        } else if (typedInit.type.kind === 'Result' && containsNever(typedInit.type)) {
          // A bare 'Success{ … }' / 'Failure{ … }' pins only one side of the
          // Result — the other stays Never, with no later use to resolve it (a
          // 'Success' never reveals the error type, §7's no-cross-statement-flow
          // rule) — so the whole 'T orfail E' has to be written down.
          diagnostics.error({ code: 'T0048', span: stmt.init.span });
        } else if (typedInit.type.kind === 'Never') {
          // A *bare* Never — the initializer diverges: an 'abort' / 'return', or
          // a block/if/match whose every path does — so it never produces a value
          // for the slot to hold, and the binding can't run (whitepaper §7). This
          // is a different fault from the '[]'/'None' "needs an annotation" family
          // (which have a real, if under-determined, value): no annotation makes
          // an unreachable binding meaningful, so it's flagged as dead code, not
          // as under-typed. (An *annotated* 'fix x: Int = abort "todo"' is still
          // allowed as a deliberate stub — the annotation branch above handles it,
          // since Never widens to Int.)
          diagnostics.error({ code: 'T0004', span: stmt.init.span, data: { name } });
        } else if (containsNever(typedInit.type)) {
          // Same wrinkle for a bare '[]' (or anything built from one, like
          // '[].reverse()'): List<Never> would otherwise freeze the slot at
          // a type nothing can ever be assigned back into (T0003 —
          // 'append' works fine as a standalone expression, since there
          // Never widens freely; only a *fixed slot type* can't take that
          // widened value back once reassigned).
          diagnostics.error({ code: 'T0003', span: stmt.init.span });
        }
        // A diverging init (T0004) has no usable slot type — Never would cascade
        // into every later use of the slot (e.g. 'print(x)' → T0019). Adopt
        // Invalid: the tombstone for the failure just reported, which absorbs in
        // both directions and stays quiet (§7). Every other inferred type —
        // including List<Never> for a bare '[]' — flows through unchanged.
        slotType = typedInit.type.kind === 'Never' ? INVALID_TYPE : typedInit.type;
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
        diagnostics.error({ code: 'T0009', span: stmt.cond.span, data: { actual: typeToString(typedCond.type) } });
      }
      const typedBody = inferBlock(stmt.body, env, diagnostics, true);
      return { kind: 'while', cond: typedCond, body: typedBody, span: stmt.span };
    }

    case 'for': {
      const typedIterable = synth(stmt.iterable, env, diagnostics);
      const it = typedIterable.type;
      // What each iteration binds `name` to is the iterable's `Item` — the
      // Iterable trait's associated type (whitepaper §5/§7): a List's element
      // type, or Int for a Range. A type with no Item isn't iterable (T0021). An
      // already-Invalid iterable stays Invalid without a second error.
      let elemType: AscentType;
      if (isInvalidType(it)) {
        elemType = INVALID_TYPE;
      } else {
        const item = iterableElement(it);
        if (item === null) {
          diagnostics.error({ code: 'T0021', span: stmt.iterable.span, data: { actual: typeToString(it) } });
          elemType = INVALID_TYPE;
        } else {
          elemType = item;
        }
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
        // tags are handled inside resolveRecordTarget (T0034/N0005/N0012).
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
      // no value to discard (T0059) — an already-effectful 'print' or loop
      // needs no 'void'. Invalid/Never already carry their own story, so stay
      // quiet there. The statement itself always yields Done.
      const typedExpr = synth(stmt.expr, env, diagnostics);
      if (typedExpr.type.kind === 'Done') {
        diagnostics.error({ code: 'T0059', span: stmt.expr.span });
      }
      return { kind: 'void', expr: typedExpr, span: stmt.span };
    }

    case 'import': {
      // Resolve a stdlib import against the compiler-known registry (whitepaper
      // §10 — no filesystem). An unknown module is N0014; a named export the
      // module doesn't have is N0015. Every resolved name is registered in its
      // own env namespace (never colliding with slots/types), so later 'min(…)'
      // or 'math.min(…)' calls find it. The typed node carries no runtime effect
      // — uses were rewritten to 'call' nodes — so the interpreter no-ops it.
      const exports = MODULE_SIGS[stmt.module];
      if (exports === undefined) {
        diagnostics.error({ code: 'N0014', span: stmt.moduleSpan, data: { module: stmt.module } });
      } else if (stmt.clause.kind === 'named') {
        for (const { name, span } of stmt.clause.names) {
          if (exports[name] === undefined) {
            diagnostics.error({ code: 'N0015', span, data: { module: stmt.module, name } });
          } else {
            env.setImportedFn(name, stmt.module);
          }
        }
      } else {
        env.setNamespace(stmt.clause.binding, stmt.module);
      }
      return { kind: 'import', clause: stmt.clause, module: stmt.module, span: stmt.span };
    }
  }
};
