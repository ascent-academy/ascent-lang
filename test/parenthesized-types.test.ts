import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { optionalOf, STRING_TYPE, INT_TYPE } from '../src/types/types.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its last
// statement's RuntimeValue. Mirrors the harness in optional.test.ts.
function evalOk(src: string): RuntimeValue {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program, { stdout: () => {} });
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

describe('parenthesized types (end-to-end)', () => {
  describe('grouping', () => {
    it('accepts an Optional of a Result — (T orfail E)? — which needs the parens', () => {
      // Without parens, 'Int orfail String?' groups as 'Int orfail (String?)';
      // the parens make it Optional<Result<Int, String>>. A None fits the outer
      // Optional.
      assert.deepEqual(
        evalOk('fix box: (Int orfail String)? = None; box == None;'),
        { type: 'Bool', value: true },
      );
    });

    it('lets a Success flow into the (T orfail E)? slot (Never side widens away)', () => {
      const src = 'fix box: (Int orfail String)? = Success{ value: 5 };'
        + ' match box { None -> -1, else -> 1 };';
      assert.deepEqual(evalOk(src), { type: 'Int', value: 1n });
    });

    it("a present (T orfail E)? holding a Failure is NOT aborted by .orAbort() — the box is Optional, not Result", () => {
      // Cross-check with the static-kind dispatch of .orAbort(): the receiver's
      // static type is Optional, so a *present* value (even a Failure record)
      // unwraps rather than crashing.
      const src = 'fix box: (Int orfail String)? = Failure{ error: "inner" };'
        + ' fix v = box.orAbort(); match v { Success -> "ok", Failure -> "got-failure" };';
      assert.deepEqual(evalOk(src), { type: 'String', value: 'got-failure' });
    });

    it('accepts redundant parens around an ordinary type', () => {
      assert.deepEqual(evalOk('fix add = fn(a: (Int), b: Int): Int => a + b; add(2, 3);'), { type: 'Int', value: 5n });
    });

    it('reports a missing close paren', () => {
      assert.ok(errorCodes('fix f = fn(a: (Int): Int => a;').includes('S0001'));
    });
  });

  describe('nested Optional collapses to a single Optional', () => {
    // Optional never nests (no runtime 'Some(…)', §4/§7): the constructor is
    // idempotent, so a nested Optional formed by *composition* is normalized
    // silently — this is what a future 'List<T?>.at(i)' relies on.
    it('optionalOf is idempotent (the composition path, no diagnostic)', () => {
      assert.deepEqual(optionalOf(optionalOf(STRING_TYPE)), optionalOf(STRING_TYPE));
      assert.deepEqual(optionalOf(optionalOf(optionalOf(INT_TYPE))), optionalOf(INT_TYPE));
    });

    it("a written 'String??' collapses to 'String?' and is usable as one", () => {
      // It still reports T0047 (see below), but the resulting slot type is the
      // collapsed 'String?', so '??' defaults it like any Optional.
      const { program } = parse('fix pick = fn(): String?? { None }; pick() ?? "default";');
      assert.ok(program !== null);
      const result = executeProgram(program, { stdout: () => {} });
      assert.equal(result.kind, 'ok');
      if (result.kind !== 'ok') throw new Error('unreachable');
      assert.deepEqual(result.value, { type: 'String', value: 'default' });
    });
  });

  describe('an explicitly-written redundant ? (T0047)', () => {
    it("flags 'String??' (adjacent, lexed as one '??' token)", () => {
      assert.deepEqual(errorCodes('fix x: String?? = None;'), ['T0047']);
    });

    it("flags '(String?)?' (redundant via a parenthesized group)", () => {
      assert.deepEqual(errorCodes('fix x: (String?)? = None;'), ['T0047']);
    });

    it("flags a redundant '?' on a compound type — 'List<Int>??'", () => {
      assert.deepEqual(errorCodes('fix x: List<Int>?? = None;'), ['T0047']);
    });

    it('does NOT flag a single, legitimate ?', () => {
      assert.deepEqual(errorCodes('fix x: String? = None; x;'), []);
    });

    it("does NOT flag '(Int orfail String)?' — one ? on a Result, not a nested Optional", () => {
      assert.deepEqual(errorCodes('fix x: (Int orfail String)? = None; x;'), []);
    });
  });
});
