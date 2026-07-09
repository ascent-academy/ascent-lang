import type { Expr, Statement, Block, FnParam, BindTarget, MatchArm } from '../parser/ast.js';

// ---- Free-variable analysis (closure captures) -----------------------
//
// A closure captures *by value* the outer names its body actually uses
// (whitepaper §5) — snapshotting them when the 'fn' literal is evaluated, not
// holding a live reference to the defining scope. This computes exactly that
// set: the *free variables* of a function body — names referenced but not bound
// within the function (its parameters plus any locals it declares).
//
// The interpreter then snapshots precisely these names at closure creation, so
// the loop-footgun cannot occur (a closure built in a loop keeps the value the
// slot had *then*, not its final value) and the closure stays cheap.
//
// Over-inclusion would be harmless (an unused capture can't be observed) but is
// avoided: block/loop/match scoping is tracked so an inner declaration never
// leaks out as a "capture", and a recursive 'fix f = fn(… f …)' binds `f` before
// its own initializer (the recursive-let rule, §5), so a function is not counted
// as a free variable of *itself* — the interpreter ties that knot separately.

// Built-in free functions are resolved by the interpreter's own 'call' case, not
// looked up as slots, so they are never captured (there is no binding to snapshot).
const BUILTIN_CALLEES: ReadonlySet<string> = new Set(['print']);

// The local names a fix/mut/for target introduces — a plain name, or every field
// a record-destructuring pattern binds.
const targetNames = (t: BindTarget): string[] =>
  t.kind === 'name' ? [t.name] : t.fields.map(f => f.bind);

export const freeVariables = (body: Block, params: readonly FnParam[]): string[] => {
  const out = new Set<string>();
  visitBlock(body, new Set(params.map(p => p.name)), out);
  return [...out];
};

// `bound` is the set of names in scope that belong to this function (params +
// locals declared so far). A referenced name not in `bound` is a capture.
const visitBlock = (block: Block, boundIn: ReadonlySet<string>, out: Set<string>): void => {
  const bound = new Set(boundIn);
  for (const stmt of block.stmts) visitStmt(stmt, bound, out);
};

const visitStmt = (stmt: Statement, bound: Set<string>, out: Set<string>): void => {
  switch (stmt.kind) {
    case 'fix':
    case 'mut':
      // Bind the target name(s) *before* the initializer so a recursive
      // 'fix f = fn(… f …)' does not count `f` as free (recursive-let, §5).
      for (const n of targetNames(stmt.target)) bound.add(n);
      visitExpr(stmt.init, bound, out);
      return;
    case 'assign':
      // Reassigning an outer slot uses it, so a free target is a capture.
      if (!bound.has(stmt.name)) out.add(stmt.name);
      visitExpr(stmt.value, bound, out);
      return;
    case 'typeDecl':
      // A type declaration introduces no runtime slot and references none.
      return;
    case 'expr':
    case 'void':
      visitExpr(stmt.expr, bound, out);
      return;
    case 'while':
      visitExpr(stmt.cond, bound, out);
      visitBlock(stmt.body, bound, out);
      return;
    case 'for': {
      visitExpr(stmt.iterable, bound, out);
      const inner = new Set(bound);
      for (const n of targetNames(stmt.target)) inner.add(n);
      visitBlock(stmt.body, inner, out);
      return;
    }
  }
};

const visitArm = (arm: MatchArm, bound: ReadonlySet<string>, out: Set<string>): void => {
  const inner = new Set(bound);
  if (arm.pattern.kind === 'variantPattern') {
    for (const f of arm.pattern.fields) inner.add(f.bind);
  } else if (arm.pattern.kind === 'bindingPattern') {
    inner.add(arm.pattern.name);
  }
  visitExpr(arm.body, inner, out);
};

const visitExpr = (expr: Expr, bound: ReadonlySet<string>, out: Set<string>): void => {
  switch (expr.kind) {
    case 'literal':
      return;
    case 'template':
      for (const p of expr.parts) if (p.kind === 'hole') visitExpr(p.expr, bound, out);
      return;
    case 'slot':
      if (!bound.has(expr.name)) out.add(expr.name);
      return;
    case 'call':
      // A user function called by name is a capture; a built-in callee is not.
      if (!BUILTIN_CALLEES.has(expr.callee) && !bound.has(expr.callee)) out.add(expr.callee);
      for (const a of expr.args) visitExpr(a, bound, out);
      return;
    case 'apply':
      // The callee is an ordinary expression — any free name in it is captured.
      visitExpr(expr.callee, bound, out);
      for (const a of expr.args) visitExpr(a, bound, out);
      return;
    case 'fn': {
      // A nested function's free variables (relative to *this* scope) are its
      // body's, minus its own parameters — so an outer name the nested body uses
      // is also a capture of the enclosing function.
      const inner = new Set(bound);
      for (const p of expr.params) inner.add(p.name);
      visitBlock(expr.body, inner, out);
      return;
    }
    case 'methodCall':
      visitExpr(expr.receiver, bound, out);
      for (const a of expr.args) visitExpr(a, bound, out);
      return;
    case 'construct':
      for (const f of expr.fields) visitExpr(f.value, bound, out);
      return;
    case 'with': {
      visitExpr(expr.base, bound, out);
      // 'its' names the base inside every index and value expression, so it is
      // bound there — never a free variable of an enclosing function.
      const inner = new Set(bound);
      inner.add('its');
      for (const u of expr.updates) {
        if (u.kind === 'index') visitExpr(u.index, inner, out);
        visitExpr(u.value, inner, out);
      }
      return;
    }
    case 'fieldAccess':
      visitExpr(expr.receiver, bound, out);
      return;
    case 'list':
      for (const el of expr.elements) visitExpr(el, bound, out);
      return;
    case 'range':
      visitExpr(expr.lo, bound, out);
      visitExpr(expr.hi, bound, out);
      return;
    case 'index':
      visitExpr(expr.list, bound, out);
      visitExpr(expr.index, bound, out);
      return;
    case 'unary':
      visitExpr(expr.operand, bound, out);
      return;
    case 'binary':
    case 'coalesce':
      visitExpr(expr.left, bound, out);
      visitExpr(expr.right, bound, out);
      return;
    case 'match':
      visitExpr(expr.subject, bound, out);
      for (const arm of expr.arms) visitArm(arm, bound, out);
      return;
    case 'try': {
      visitExpr(expr.subject, bound, out);
      if (expr.elseClause !== null) {
        // The 'else' body runs with the error name (if any) in scope, so it isn't
        // a free variable of the enclosing function.
        const inner = new Set(bound);
        if (expr.elseClause.binding !== null) inner.add(expr.elseClause.binding.name);
        visitExpr(expr.elseClause.body, inner, out);
      }
      return;
    }
    case 'block':
      visitBlock(expr, bound, out);
      return;
    case 'if':
      visitExpr(expr.cond, bound, out);
      visitBlock(expr.then, bound, out);
      if (expr.else !== null) {
        if (expr.else.kind === 'if') visitExpr(expr.else, bound, out);
        else visitBlock(expr.else, bound, out);
      }
      return;
  }
};
