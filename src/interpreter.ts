import type { ProgramArg } from './parser/ast.js';
import type { TypedExpr, TypedBlock, TypedStatement, TypedProgram } from './parser/typed-ast.js';
// valueToString (plain, no colour) is how Ascent renders a runtime value to
// its output text — the language owns this, so the host's sink takes strings.
import { valueToString } from './parser/printer.js';
import { RuntimeError } from './errors/runtime-error.js';
import {
  coerce, scalarToString,
  intVal, floatVal, strVal, boolVal, rangeVal, recordVal, NONE, DONE,
  type ScalarValue, type RuntimeValue,
} from './interpreter/values.js';
import { checkIntOverflow, checkFiniteFloat, evaluateBinary } from './interpreter/arithmetic.js';
import { Environment, type AssignResult, type OutputSink } from './interpreter/env.js';
import { evalMethodCall } from './interpreter/builtins.js';

// Re-export the value domain and the scope chain so existing importers of
// './interpreter.js' (lib.ts, the CLI, the tests) keep resolving
// RuntimeValue/ScalarValue/Environment/AssignResult/OutputSink here;
// interpreter/values.ts and interpreter/env.ts are the sources of truth.
export type { ScalarValue, RuntimeValue };
export { Environment };
export type { AssignResult, OutputSink };

export const evaluateExpr = (expr: TypedExpr, env: Environment): RuntimeValue => {
  switch (expr.kind) {
    case 'literal': {
      switch (expr.valueType) {
        case 'Int': return intVal(checkIntOverflow(expr.value, expr.span));
        case 'Float': return floatVal(checkFiniteFloat(expr.value, expr.span));
        case 'Bool': return boolVal(expr.value);
        case 'String': return strVal(expr.value);
        case 'None': return NONE;
        case 'Done': return DONE;
      }
    }
    case 'template': {
      let result = '';
      for (const part of expr.parts) {
        if (part.kind === 'text') { result += part.value; continue; }
        result += scalarToString(evaluateExpr(part.expr, env));
      }
      return strVal(result);
    }
    case 'slot': {
      // Name-binding errors (N0001–N0003) are caught at type-check time; this
      // is an internal guard.
      const value = env.get(expr.name);
      if (value === undefined) throw new Error(`internal: unbound slot '${expr.name}'`);
      return value;
    }
    case 'call': {
      // print is the only built-in; others are rejected by the type checker.
      const args = expr.args.map(a => evaluateExpr(a, env));
      if (expr.callee === 'print') {
        // The checker proved the argument is Display (a scalar), so it has a
        // canonical text form — the same one an interpolation hole renders.
        // Emit it and yield Done, since a side-effecting call has no meaningful
        // result (whitepaper §7).
        env.output(scalarToString(args[0]!));
        return DONE;
      }
      throw new Error(`internal: unknown built-in '${expr.callee}'`);
    }
    case 'methodCall': {
      const receiver = evaluateExpr(expr.receiver, env);
      const args = expr.args.map(a => evaluateExpr(a, env));
      // The ctx carries the static types alongside the values: the List methods
      // widen their elements to the result element type, and each source's own
      // static type is the `from` its coercion witness needs.
      return evalMethodCall(receiver, expr.method, args, {
        span: expr.span,
        receiverType: expr.receiver.type,
        argTypes: expr.args.map(a => a.type),
        resultType: expr.type,
      });
    }
    case 'construct': {
      // Build the record's fields in declaration order (the typed node is
      // already ordered), coercing each value from its own type into the
      // declared field type — the same Int → Float (and nested) widening a
      // fix/mut init gets against its slotType.
      const fields = new Map<string, RuntimeValue>();
      for (const f of expr.fields) {
        fields.set(f.name, coerce(evaluateExpr(f.value, env), f.value.type, f.declaredType));
      }
      return recordVal(expr.typeName, fields);
    }
    case 'fieldAccess': {
      const receiver = evaluateExpr(expr.receiver, env);
      if (receiver.type !== 'Record') throw new Error('internal: field access on a non-record');
      const value = receiver.fields.get(expr.field);
      if (value === undefined) throw new Error(`internal: no field '${expr.field}' on ${receiver.name}`);
      return value;
    }
    case 'list': {
      // expr.type is List<T>; coerce each element from its own static type to
      // T. Going through the full witness (not just a top-level Int → Float)
      // is what widens a nested element, e.g. a List<Int> element under a
      // List<List<Float>> literal.
      const elemType = expr.type.kind === 'List' ? expr.type.elem : null;
      const elements = expr.elements.map(el => {
        const v = evaluateExpr(el, env);
        return elemType !== null ? coerce(v, el.type, elemType) : v;
      });
      return { type: 'List', elements };
    }
    case 'range': {
      const lo = evaluateExpr(expr.lo, env);
      const hi = evaluateExpr(expr.hi, env);
      if (lo.type !== 'Int' || hi.type !== 'Int') throw new Error('internal: range bound not an Int');
      // No lo <= hi requirement: a range with lo >= hi is simply empty
      // (design.md §4 — half-open, so '5..5' and '5..3' both yield nothing).
      return rangeVal(lo.value, hi.value);
    }
    case 'index': {
      const list = evaluateExpr(expr.list, env);
      const idx = evaluateExpr(expr.index, env);
      if (list.type !== 'List') throw new Error('internal: index receiver not a List');
      if (idx.type !== 'Int') throw new Error('internal: index not an Int');
      const i = Number(idx.value);
      if (i < 0 || i >= list.elements.length) {
        throw new RuntimeError({
          code: 'R0005',
          span: expr.index.span,
          data: { length: String(list.elements.length) },
        });
      }
      return list.elements[i]!;
    }
    case 'unary': {
      const operand = evaluateExpr(expr.operand, env);
      if (expr.op === 'not') {
        if (operand.type !== 'Bool') throw new Error(`internal: 'not' on ${operand.type}`);
        return boolVal(!operand.value);
      }
      if (operand.type === 'Int') return intVal(checkIntOverflow(-operand.value, expr.span));
      if (operand.type === 'Float') return floatVal(checkFiniteFloat(-operand.value, expr.span));
      throw new Error(`internal: unary '-' on ${operand.type}`);
    }
    case 'binary': {
      // 'and'/'or' short-circuit: the left operand alone can decide the
      // result ('False and e' / 'True or e'), so 'e' is only evaluated
      // when it's still needed — the same laziness every mainstream
      // language gives its logical operators.
      if (expr.op === 'and' || expr.op === 'or') {
        const left = evaluateExpr(expr.left, env);
        if (left.type !== 'Bool') throw new Error(`internal: '${expr.op}' on non-Bool`);
        if (expr.op === 'and' ? !left.value : left.value) return left;
        const right = evaluateExpr(expr.right, env);
        if (right.type !== 'Bool') throw new Error(`internal: '${expr.op}' on non-Bool`);
        return right;
      }
      // expr.right.span is where R0002/R0003 point — at the divisor/exponent,
      // not the whole expression (expr.span, used for an overflow result).
      return evaluateBinary(
        expr.op, evaluateExpr(expr.left, env), evaluateExpr(expr.right, env), expr.span, expr.right.span,
      );
    }
    case 'block': {
      return evaluateBlock(expr, env);
    }
    case 'if': {
      const cond = evaluateExpr(expr.cond, env);
      if (cond.type !== 'Bool') throw new Error('internal: if condition not Bool');
      if (cond.value) return evaluateExpr(expr.then, env);
      if (expr.else !== null) return evaluateExpr(expr.else, env);
      return DONE;
    }
  }
};

const evaluateBlock = (block: TypedBlock, env: Environment): RuntimeValue => {
  const blockEnv = env.child();
  let result: RuntimeValue = DONE;
  for (const stmt of block.stmts) {
    result = executeStmt(stmt, blockEnv);
  }
  return result;
};

export const executeStmt = (stmt: TypedStatement, env: Environment): RuntimeValue => {
  switch (stmt.kind) {
    case 'fix':
    case 'mut': {
      // Coerce the init value from its own type to the declared slot type
      // (handles Int → Float when the annotation says Float but the literal is
      // an Int, and any nested widening the same edge implies).
      const value = coerce(evaluateExpr(stmt.init, env), stmt.init.type, stmt.slotType);
      env.declare(stmt.name, value, stmt.kind === 'mut');
      return DONE;
    }
    case 'assign': {
      const value = coerce(evaluateExpr(stmt.value, env), stmt.value.type, stmt.slotType);
      const result = env.assign(stmt.name, value);
      if (result !== 'ok') throw new Error(`internal: assign '${stmt.name}' → ${result}`);
      return DONE;
    }
    case 'typeDecl':
      // Types are erased at runtime — a declaration carries no value and does
      // nothing when executed (its effect was on the typechecker's registry).
      return DONE;
    case 'expr':
      return evaluateExpr(stmt.expr, env);
    case 'while': {
      // Each iteration evaluates the body as a block, giving it a fresh
      // child scope — a 'fix' from one iteration doesn't leak into the next.
      while (true) {
        const cond = evaluateExpr(stmt.cond, env);
        if (cond.type !== 'Bool') throw new Error('internal: while condition not Bool');
        if (!cond.value) break;
        evaluateBlock(stmt.body, env);
      }
      return DONE;
    }
    case 'for': {
      // Each iteration binds the loop variable in a fresh child scope, then
      // runs the body (which opens its own scope under it) — so the binding
      // is a new fixed slot per pass, never leaking or carrying over.
      const runBody = (value: RuntimeValue): void => {
        const loopEnv = env.child();
        loopEnv.declare(stmt.name, value, false);
        evaluateBlock(stmt.body, loopEnv);
      };

      const iterable = evaluateExpr(stmt.iterable, env);
      if (iterable.type === 'Range') {
        // Half-open: lo up to but not including hi. A step of +1 always
        // terminates, and lo >= hi runs zero times (design.md §4).
        for (let i = iterable.lo; i < iterable.hi; i++) runBody(intVal(i));
      } else if (iterable.type === 'List') {
        // Elements are already the list's element type (coerced at build
        // time), so each is bound as-is — no re-coercion needed.
        for (const el of iterable.elements) runBody(el);
      } else {
        throw new Error(`internal: for over non-iterable ${iterable.type}`);
      }
      return DONE;
    }
  }
};

// Bound to one program's `args`: `set` rejects a name that isn't one of
// those args (which, coming from a parsed program, are already legal slot
// names — no separate syntax check needed), and a value whose type doesn't
// match the arg's declared type.
export class ProgramInputs {
  private readonly argDefs: Map<string, ProgramArg>;
  private readonly values = new Map<string, ScalarValue>();

  public constructor(argDefs: ProgramArg[]) {
    this.argDefs = new Map(argDefs.map(def => [def.name, def]));
  }

  public set(name: string, value: ScalarValue): this {
    const argDef = this.argDefs.get(name);
    if (argDef === undefined) {
      throw new Error(`'${name}' is not a declared program input`);
    }
    if (argDef.type !== value.type) {
      throw new Error(`'${name}': expected ${argDef.type}, got ${value.type}`);
    }
    this.values.set(name, value);
    return this;
  }

  public get(name: string): ScalarValue | undefined {
    return this.values.get(name);
  }
}

// The outcome of a whole program run: the final value it produced, or the
// RuntimeError (§9's bug tier) that crashed it. The program's *output* — that
// same final value and any `print`s along the way — is also streamed as text to
// the `output` sink as it runs (that's what a host displays); `value` is the
// structured result for a programmatic caller, so the two are complementary, not
// a choice. An internal invariant violation (a plain Error, not a RuntimeError)
// still propagates as an exception, since that's a bug in the interpreter, not a
// modeled outcome.
export type RuntimeResult =
  | { kind: 'ok'; value: RuntimeValue }
  | { kind: 'error'; error: RuntimeError };

// Creates the top-level Environment itself, wiring in the output sink and
// declaring each of the program's `args` as a fixed slot from `inputs` —
// callers provide values, not scopes. The program's final value (the
// block-value rule, whitepaper §2) is emitted to the same sink `print` uses,
// unless it's Done — the "no information" value is nothing to output.
export const executeProgram = (
  program: TypedProgram,
  output: OutputSink,
  inputs: ProgramInputs = new ProgramInputs(program.args),
): RuntimeResult => {
  const env = new Environment(null, output);
  for (const arg of program.args) {
    const value = inputs.get(arg.name);
    if (value === undefined) throw new Error(`missing input '${arg.name}'`);
    env.declare(arg.name, value, false);
  }

  try {
    let result: RuntimeValue = DONE;
    for (const stmt of program.stmts) {
      result = executeStmt(stmt, env);
    }
    // Ascent renders the final value to its display string (whitepaper §2's
    // block-value output) and streams it to the sink; the sink only ever sees
    // text. Done — the "no information" value — is nothing to output. The value
    // itself is still returned for a programmatic caller.
    if (result.type !== 'Done') env.output(valueToString(result));
    return { kind: 'ok', value: result };
  } catch (e) {
    if (e instanceof RuntimeError) return { kind: 'error', error: e };
    throw e;
  }
};
