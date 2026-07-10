import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue. Output is streamed to a sink we discard here —
// these tests assert on the structured value executeProgram returns, not its text.
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

describe('Ranges and for loops', () => {
  describe('range literals', () => {
    it('a..b is a Range value carrying its bounds', () => {
      assert.deepEqual(evalOk('2..5;'), { type: 'Range', lo: 2n, hi: 5n });
    });

    it('bounds can be slots and arithmetic', () => {
      assert.deepEqual(evalOk('fix a = 1; fix b = 4; a + 1 .. b * 2;'), { type: 'Range', lo: 2n, hi: 8n });
    });

    it("'..' binds looser than additive: '1+1..6-1' is '(1+1)..(6-1)'", () => {
      assert.deepEqual(evalOk('1 + 1 .. 6 - 1;'), { type: 'Range', lo: 2n, hi: 5n });
    });

    it('a low bound at or above the high bound is a (valid) empty range', () => {
      assert.deepEqual(evalOk('5..3;'), { type: 'Range', lo: 5n, hi: 3n });
    });

    it('two ranges are equal by their bounds', () => {
      assert.deepEqual(evalOk('0..3 == 0..3;'), { type: 'Bool', value: true });
      assert.deepEqual(evalOk('0..3 == 0..4;'), { type: 'Bool', value: false });
    });

    it('rejects a non-Int bound with T0020', () => {
      assert.deepEqual(errorCodes('0..3.5;'), ['T0020']);
      assert.deepEqual(errorCodes('"a".."z";'), ['T0020']);
    });
  });

  describe('range methods', () => {
    it('.length() is the count of items (hi - lo), 0 when empty', () => {
      assert.deepEqual(evalOk('(2..6).length();'), { type: 'Int', value: 4n });
      assert.deepEqual(evalOk('(5..5).length();'), { type: 'Int', value: 0n });
      assert.deepEqual(evalOk('(5..3).length();'), { type: 'Int', value: 0n });
    });

    it('.toList() materializes the half-open items', () => {
      assert.deepEqual(evalOk('(0..3).toList();'), {
        type: 'List',
        elements: [{ type: 'Int', value: 0n }, { type: 'Int', value: 1n }, { type: 'Int', value: 2n }],
      });
      assert.deepEqual(evalOk('(0..0).toList();'), { type: 'List', elements: [] });
    });

    it('.contains(i) tests half-open membership', () => {
      assert.deepEqual(evalOk('(0..10).contains(0);'), { type: 'Bool', value: true });
      assert.deepEqual(evalOk('(0..10).contains(9);'), { type: 'Bool', value: true });
      assert.deepEqual(evalOk('(0..10).contains(10);'), { type: 'Bool', value: false });
      assert.deepEqual(evalOk('(0..10).contains(-1);'), { type: 'Bool', value: false });
    });
  });

  describe('for loops', () => {
    it('iterates a range, binding each Int', () => {
      assert.deepEqual(evalOk('mut s = 0; for i in 0..5 { s = s + i; }; s;'), { type: 'Int', value: 10n });
    });

    it('iterates a list, binding each element', () => {
      assert.deepEqual(evalOk('mut s = 0; for x in [10, 20, 30] { s = s + x; }; s;'), { type: 'Int', value: 60n });
    });

    it('runs zero times over an empty range or list', () => {
      assert.deepEqual(evalOk('mut s = 0; for i in 3..3 { s = s + 1; }; s;'), { type: 'Int', value: 0n });
      assert.deepEqual(evalOk('mut s = 0; for x in [] { s = s + 1; }; s;'), { type: 'Int', value: 0n });
    });

    it('binds the loop variable at the element type (a String element here)', () => {
      // The body concatenates via interpolation, which only accepts a scalar
      // — proof the loop variable is typed String, not something opaque.
      assert.deepEqual(
        evalOk('mut out = ""; for w in ["a", "b"] { out = "${out}${w}"; }; out;'),
        { type: 'String', value: 'ab' },
      );
    });

    it('a for loop is a statement yielding Done', () => {
      // The body ends in a non-Done value the loop would discard, so it must be
      // discarded on purpose with 'void' (§2); the loop itself still yields Done.
      assert.deepEqual(evalOk('for i in 0..3 { void i; }'), { type: 'Done' });
    });

    it('the loop variable is a fixed binding — reassigning it is N0002', () => {
      assert.deepEqual(errorCodes('for i in 0..3 { i = i + 1; };'), ['N0002']);
    });

    it('rejects a non-iterable with T0021', () => {
      assert.deepEqual(errorCodes('for x in 5 { x; };'), ['T0021']);
      assert.deepEqual(errorCodes('for c in "hi" { c; };'), ['T0021']);
    });

    it('needs a loop name and an in (S0015 / S0016)', () => {
      assert.equal(errorCodes('for in xs { 1; };')[0], 'S0015');
      assert.equal(errorCodes('for x xs { 1; };')[0], 'S0016');
    });
  });
});
