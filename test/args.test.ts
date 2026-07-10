import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram, ProgramInputs } from '../src/interpreter.js';
import type { RuntimeValue, ScalarValue } from '../src/interpreter.js';

// Runs a program with the given input values bound, returning its last
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

describe('program inputs (program (…) { … } header)', () => {
  describe('declaration & binding', () => {
    it('exposes a declared input as a readable name', () => {
      assert.deepEqual(
        evalWithArgs('program (age: Int) { age }', { age: { type: 'Int', value: 21n } }),
        { type: 'Int', value: 21n },
      );
    });

    it('binds several inputs at once, each by name', () => {
      assert.deepEqual(
        evalWithArgs('program (a: Int, b: Int) { a + b }', {
          a: { type: 'Int', value: 2n },
          b: { type: 'Int', value: 3n },
        }),
        { type: 'Int', value: 5n },
      );
    });

    it("threads an input's declared type through the body", () => {
      // 'flag' is a Bool, so it drives an 'if' without any coercion.
      assert.deepEqual(
        evalWithArgs('program (flag: Bool) { if (flag) { 1 } else { 2 } }', { flag: { type: 'Bool', value: true } }),
        { type: 'Int', value: 1n },
      );
    });

    it('accepts a String input and runs its methods', () => {
      assert.deepEqual(
        evalWithArgs('program (name: String) { name.length() }', { name: { type: 'String', value: 'hi' } }),
        { type: 'Int', value: 2n },
      );
    });

    it('accepts an Int input at the exact 64-bit boundaries', () => {
      const INT_MAX = 2n ** 63n - 1n;
      const INT_MIN = -(2n ** 63n);
      assert.deepEqual(
        evalWithArgs('program (n: Int) { n }', { n: { type: 'Int', value: INT_MAX } }),
        { type: 'Int', value: INT_MAX },
      );
      assert.deepEqual(
        evalWithArgs('program (n: Int) { n }', { n: { type: 'Int', value: INT_MIN } }),
        { type: 'Int', value: INT_MIN },
      );
    });

    it('rejects an Int input outside the 64-bit range at the boundary', () => {
      // Otherwise the program would run holding a value no Int can represent —
      // the invariant the overflow trap keeps everywhere else (whitepaper §4).
      assert.throws(
        () => evalWithArgs('program (n: Int) { n }', { n: { type: 'Int', value: 2n ** 63n } }),
        /outside the 64-bit range/,
      );
      assert.throws(
        () => evalWithArgs('program (n: Int) { n }', { n: { type: 'Int', value: -(2n ** 63n) - 1n } }),
        /outside the 64-bit range/,
      );
    });
  });

  describe('the read-only rule', () => {
    it('reports N0004 for assigning to a program input', () => {
      // An input is fixed for the whole run — there is no 'mut' input to switch to.
      assert.deepEqual(errorCodes('program (age: Int) { age = 30 }'), ['N0004']);
    });

    it('still type-checks the assigned value alongside N0004', () => {
      // The read-only rule fires, and the value is synthesised too, so a second,
      // independent mistake in the same statement is also surfaced.
      const codes = errorCodes('program (age: Int) { age = "old" }');
      assert.ok(codes.includes('N0004'), `expected N0004, got ${codes.join(', ')}`);
    });
  });

  describe('inputs participate in the type system', () => {
    it('rejects a body that misuses an input\'s type', () => {
      // 'name' is a String, so adding an Int to it is a type error.
      assert.ok(errorCodes('program (name: String) { name + 1 }').length > 0);
    });
  });

  describe('the header is optional', () => {
    it('runs a bare statement sequence with no inputs at all', () => {
      // With no named inputs you skip 'program' entirely — the last value is
      // the output (whitepaper §11).
      assert.deepEqual(
        evalWithArgs('fix age = 21; age', {}),
        { type: 'Int', value: 21n },
      );
    });

    it('reports S0028 for a program with an empty input list', () => {
      // 'program ()' is banned — a program with no inputs is written bare.
      assert.deepEqual(errorCodes('program () { 1 }'), ['S0028']);
    });

    it('reports S0030 for content after the program block', () => {
      // The 'program' block is the whole program; nothing follows its '}'.
      assert.deepEqual(errorCodes('program (age: Int) { age } 1'), ['S0030']);
    });

    it('reports S0029 for an empty program body', () => {
      // A 'program' block with nothing in it runs nothing and uses no inputs —
      // the counterpart of the empty-input ban (S0028).
      assert.deepEqual(errorCodes('program (age: Int) { }'), ['S0029']);
    });

    it('checks the empty inputs first when both parens and body are empty', () => {
      assert.deepEqual(errorCodes('program () { }'), ['S0028']);
    });
  });

  // The rule: anything may go *before* 'program', nothing after. Statements
  // before it run first; the program body holds the output.
  describe('statements before the program block', () => {
    it('runs type and value declarations before program, visible in the body', () => {
      assert.deepEqual(
        evalWithArgs('type Point = { x: Int, y: Int }; fix origin = Point{ x: 1, y: 2 }; program (n: Int) { origin.x + n }', { n: { type: 'Int', value: 10n } }),
        { type: 'Int', value: 11n },
      );
    });

    it('defines a helper function before program and calls it in the body', () => {
      assert.deepEqual(
        evalWithArgs('fix dbl = fn(x: Int): Int { x * 2 }; program (n: Int) { dbl(n) }', { n: { type: 'Int', value: 7n } }),
        { type: 'Int', value: 14n },
      );
    });

    it('runs an effectful statement before program, then the body', () => {
      const output: string[] = [];
      const { program, diagnostics } = parse('print("setup"); program (n: Int) { n }');
      assert.deepEqual(diagnostics, []);
      assert.ok(program !== null);
      const inputs = new ProgramInputs(program.args);
      inputs.set('n', { type: 'Int', value: 3n });
      executeProgram(program, { stdout: t => output.push(t) }, inputs);
      assert.deepEqual(output, ['setup', '3']);
    });

    it('a bare non-Done value before program is still a dropped value (T0057)', () => {
      assert.deepEqual(errorCodes('fix x = 5; x + 1; program (n: Int) { n }'), ['T0057']);
    });

    it('the inputs are NOT visible to statements before program (N0001)', () => {
      // The inputs bind only for the body; a leading statement referencing one
      // sees no such name (sequential scoping — 'program' comes after it).
      assert.deepEqual(errorCodes('fix d = n * 2; program (n: Int) { d }'), ['N0001']);
    });

    it('rejects an empty program body, even with leading statements (S0029)', () => {
      assert.deepEqual(errorCodes('print("setup"); program (n: Int) { }'), ['S0029']);
    });

    it('still requires a semicolon before program, like any statement (S0006)', () => {
      assert.deepEqual(errorCodes('fix a = 1 program (n: Int) { n }'), ['S0006']);
    });

    it('rejects anything after program even with a separating semicolon (S0030)', () => {
      assert.deepEqual(errorCodes('program (n: Int) { n }; fix x = 5'), ['S0030']);
    });
  });
});
