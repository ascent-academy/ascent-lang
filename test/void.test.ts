import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue. Output goes to a sink we discard — these
// tests assert on the structured value, not the emitted text.
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

// The "value must go somewhere" rule (whitepaper §2): a real value left in a
// Done-required position — a non-final statement or a loop body — is dropped,
// which is a compile error unless discarded on purpose with 'void'.
describe('void and the discard rule', () => {
  describe('T0057 — a value dropped by a following statement', () => {
    it('flags a non-final bare value at the top level', () => {
      assert.deepEqual(errorCodes('1 + 1; 2;'), ['T0057']);
      assert.deepEqual(errorCodes('"a"; "b";'), ['T0057']);
    });

    it('flags a non-final bare value inside a block (value-position branch)', () => {
      // The branch's *last* statement is its value; the one before it is dropped.
      assert.deepEqual(errorCodes('fix x = if (True) { 7; 8 } else { 9 }; x;'), ['T0057']);
    });

    it('does not flag a non-final statement that already yields Done', () => {
      // A declaration, an assignment, and an effectful print all yield Done —
      // nothing is dropped, so no 'void' is needed.
      assert.deepEqual(errorCodes('fix x = 5; x;'), []);
      assert.deepEqual(errorCodes('mut y = 1; y = 2; y;'), []);
      assert.deepEqual(errorCodes('print("hi"); 5;'), []);
    });

    it("does not flag the program's final statement (a value position)", () => {
      assert.deepEqual(evalOk('1 + 1;'), { type: 'Int', value: 2n });
    });

    it("'void' discards the value and clears the error", () => {
      assert.deepEqual(errorCodes('void 1 + 1; 2;'), []);
      assert.deepEqual(evalOk('void 1 + 1; 2;'), { type: 'Int', value: 2n });
    });

    it('a statement-position if used for effect takes void on the whole expression', () => {
      assert.deepEqual(errorCodes('if (True) { 5 } else { 6 }; 0;'), ['T0057']);
      assert.deepEqual(errorCodes('void if (True) { 5 } else { 6 }; 0;'), []);
    });
  });

  describe('T0058 — a value dropped by the loop', () => {
    it('flags a for/while body ending in a non-Done value', () => {
      assert.deepEqual(errorCodes('for i in 0..3 { i };'), ['T0058']);
      assert.deepEqual(errorCodes('while (False) { 1 };'), ['T0058']);
    });

    it('does not flag a body that already yields Done', () => {
      assert.deepEqual(errorCodes('mut s = 0; for i in 0..3 { s = s + i }; s;'), []);
      assert.deepEqual(errorCodes('for i in 0..3 { print(i) };'), []);
    });

    it("'void' in the body discards the per-pass value; the loop yields Done", () => {
      assert.deepEqual(evalOk('for i in 0..3 { void i; }'), { type: 'Done' });
    });

    it('a non-final drop and a loop drop can both fire in one body', () => {
      // First 'i' is dropped by the statement after it (T0057); the last 'i' is
      // dropped by the loop (T0058).
      assert.deepEqual(errorCodes('for i in 0..3 { i; i };'), ['T0057', 'T0058']);
    });

    it('a loop still accumulates through a mutable slot', () => {
      assert.deepEqual(evalOk('mut s = 0; for i in 0..3 { s = s + i }; s;'), { type: 'Int', value: 3n });
    });
  });

  describe('T0059 — void on a value that is already Done', () => {
    it("flags 'void' on a Done expression", () => {
      assert.deepEqual(errorCodes('void Done;'), ['T0059']);
      assert.deepEqual(errorCodes('void print("x");'), ['T0059']);
    });
  });

  describe('void semantics', () => {
    it('a void statement yields Done', () => {
      assert.deepEqual(evalOk('void 2 + 2;'), { type: 'Done' });
    });

    it('void still evaluates its operand (a crash inside it surfaces)', () => {
      // Out-of-bounds indexing crashes at run time — proof void ran the expr
      // rather than skipping it.
      const { program } = parse('void [1, 2][5];');
      assert.ok(program !== null);
      const result = executeProgram(program, { stdout: () => {} });
      assert.equal(result.kind, 'error');
    });
  });
});
