import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue.
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

// A '{ … }' block is a *body* — of an 'if'/'while'/'for', a function, or a
// 'match' arm — never a value on its own. A '{' can't start an expression, so
// every value position rejects one with S0044.
describe('a block is not a value (S0044)', () => {
  describe('the { symbol never starts an expression', () => {
    it('rejects a block bound to a name (fix)', () => {
      assert.deepEqual(errorCodes('fix blck = { 5 };'), ['S0044']);
    });

    it('rejects a block as a lone statement', () => {
      assert.deepEqual(errorCodes('{ 5 };'), ['S0044']);
    });

    it('rejects a block as a call argument', () => {
      assert.deepEqual(errorCodes('print({ 5 });'), ['S0044']);
    });

    it('rejects a block as an operand of a binary expression', () => {
      assert.deepEqual(errorCodes('fix x = 1 + { 2 };'), ['S0044']);
    });

    it('rejects a block as a list element', () => {
      assert.deepEqual(errorCodes('fix xs = [{ 1 }];'), ['S0044']);
    });

    it('rejects a block nested as a statement inside another block', () => {
      // Panic-mode recovery may add a follow-on marker after the skipped
      // statement; S0044 is the diagnosed cause.
      assert.equal(errorCodes('fix x = if (True) { { 5 } } else { 6 }; x;')[0], 'S0044');
    });
  });

  describe('blocks still work as the body of a guarding construct', () => {
    it('an if/else branch is a block', () => {
      assert.deepEqual(evalOk('fix x = if (True) { fix a = 2; a * 3 } else { 0 }; x;'),
        { type: 'Int', value: 6n });
    });

    it("a match arm's body may be a block", () => {
      assert.deepEqual(evalOk('fix n = 2; match n { 0 -> { 100 }, else -> { fix m = n + 1; m } };'),
        { type: 'Int', value: 3n });
    });

    it('a function body is a block', () => {
      assert.deepEqual(evalOk('fix f = fn(n: Int): Int { fix r = n + 1; r }; f(4);'),
        { type: 'Int', value: 5n });
    });
  });
});
