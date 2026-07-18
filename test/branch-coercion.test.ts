import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue.
function evalOk(src: string): RuntimeValue {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

// Runs a program and returns everything it wrote to the output sink (each
// `print`, plus the final value unless it's Done).
function evalOut(src: string): string {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  let out = '';
  const result = executeProgram(program, testHost(t => { out += t; }));
  assert.equal(result.kind, 'ok');
  return out;
}

// An 'if'/'match' used as a value has the *join* type of its branches/arms, so
// the branch that actually runs is widened to that join — the taken branch's
// own value never leaks out at its narrower type. (Both constructs share this;
// it's the same coercion a fix/mut init gets against its declared slot type.)
describe('branch-join value coercion (if / match)', () => {
  describe('if', () => {
    it('widens the taken Int branch to the Float join', () => {
      assert.deepEqual(evalOk('if (True) { 1 } else { 2.5 };'), { type: 'Float', value: 1 });
      assert.deepEqual(evalOk('if (False) { 1 } else { 2.5 };'), { type: 'Float', value: 2.5 });
    });

    it('a printed if shows the joined (Float) form, not the raw Int', () => {
      assert.equal(evalOut('print(if (True) { 1 } else { 2.5 });'), '1.0');
    });

    it('widens through an else-if chain', () => {
      assert.deepEqual(evalOk('if (False) { 1 } else if (True) { 2 } else { 3.5 };'),
        { type: 'Float', value: 2 });
    });

    it('widens list elements covariantly (List<Int> branch into List<Float>)', () => {
      assert.deepEqual(evalOk('if (True) { [1] } else { [2.5] };'),
        { type: 'List', elements: [{ type: 'Float', value: 1 }] });
    });

    it('is a no-op when the branch already has the join type', () => {
      assert.deepEqual(evalOk('if (True) { 1 } else { 2 };'), { type: 'Int', value: 1n });
    });
  });

  describe('match', () => {
    it('widens the taken Int arm to the Float join', () => {
      assert.deepEqual(evalOk('match 0 { 0 -> 1, else -> 2.5 };'), { type: 'Float', value: 1 });
      assert.deepEqual(evalOk('match 9 { 0 -> 1, else -> 2.5 };'), { type: 'Float', value: 2.5 });
    });

    it('a printed match shows the joined (Float) form, not the raw Int', () => {
      assert.equal(evalOut('print(match 0 { 0 -> 1, else -> 2.5 });'), '1.0');
    });

    it('widens list elements covariantly', () => {
      assert.deepEqual(evalOk('match 0 { 0 -> [1], else -> [2.5] };'),
        { type: 'List', elements: [{ type: 'Float', value: 1 }] });
    });

    it('is a no-op when the arm already has the join type', () => {
      assert.deepEqual(evalOk('match 0 { 0 -> 1, else -> 2 };'), { type: 'Int', value: 1n });
    });

    it('still coerces further into a wider declared slot', () => {
      // Arms join to Int; the Float slot then widens the whole result.
      assert.deepEqual(evalOk('fix x: Float = match 0 { 0 -> 1, else -> 2 }; x;'),
        { type: 'Float', value: 1 });
    });
  });
});
