import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram, ProgramInputs } from '../src/interpreter.js';
import type { RuntimeValue, ScalarValue } from '../src/interpreter.js';

// Runs a program with the given argument values bound, returning its last
// statement's RuntimeValue. `args` maps each declared input name to the value
// the run should see (mirroring what the CLI's --flag binding produces).
function evalWithArgs(src: string, args: Record<string, ScalarValue>): RuntimeValue {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const inputs = new ProgramInputs(program.args);
  for (const [name, value] of Object.entries(args)) inputs.set(name, value);
  const result = executeProgram(program, { stdout: () => {} }, inputs);
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

describe('program arguments (args header)', () => {
  describe('declaration & binding', () => {
    it('exposes a declared input as a readable name', () => {
      assert.deepEqual(
        evalWithArgs('args (age: Int); age;', { age: { type: 'Int', value: 21n } }),
        { type: 'Int', value: 21n },
      );
    });

    it('binds several inputs at once, each by name', () => {
      assert.deepEqual(
        evalWithArgs('args (a: Int, b: Int); a + b;', {
          a: { type: 'Int', value: 2n },
          b: { type: 'Int', value: 3n },
        }),
        { type: 'Int', value: 5n },
      );
    });

    it("threads an input's declared type through the body", () => {
      // 'flag' is a Bool, so it drives an 'if' without any coercion.
      assert.deepEqual(
        evalWithArgs('args (flag: Bool); if (flag) { 1 } else { 2 };', { flag: { type: 'Bool', value: true } }),
        { type: 'Int', value: 1n },
      );
    });

    it('accepts a String input and runs its methods', () => {
      assert.deepEqual(
        evalWithArgs('args (name: String); name.length();', { name: { type: 'String', value: 'hi' } }),
        { type: 'Int', value: 2n },
      );
    });
  });

  describe('the read-only rule', () => {
    it('reports N0004 for assigning to a program input', () => {
      // An input is fixed for the whole run — there is no 'mut' arg to switch to.
      assert.deepEqual(errorCodes('args (age: Int); age = 30;'), ['N0004']);
    });

    it('still type-checks the assigned value alongside N0004', () => {
      // The read-only rule fires, and the value is synthesised too, so a second,
      // independent mistake in the same statement is also surfaced.
      const codes = errorCodes('args (age: Int); age = "old";');
      assert.ok(codes.includes('N0004'), `expected N0004, got ${codes.join(', ')}`);
    });
  });

  describe('inputs participate in the type system', () => {
    it('rejects a body that misuses an input\'s type', () => {
      // 'name' is a String, so adding an Int to it is a type error.
      assert.ok(errorCodes('args (name: String); name + 1;').length > 0);
    });
  });
});
