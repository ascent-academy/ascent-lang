import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';

// Runs a program expected to typecheck and evaluate cleanly, returning the
// whole sequence of values it emitted to the output sink — every `print` call
// in order, followed by the program's final value (unless that's Done, which
// executeProgram doesn't emit). This is what a host (the CLI's stdout, a
// browser console panel, this array) receives.
function outputsOf(src: string): RuntimeValue[] {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const outputs: RuntimeValue[] = [];
  const result = executeProgram(program, v => outputs.push(v));
  assert.equal(result.kind, 'ok');
  return outputs;
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

const str = (value: string): RuntimeValue => ({ type: 'String', value });
const int = (value: bigint): RuntimeValue => ({ type: 'Int', value });

describe('print (end-to-end)', () => {
  describe('output', () => {
    it('emits its String argument to the sink', () => {
      assert.deepEqual(outputsOf('print("hi");'), [str('hi')]);
    });

    it('emits an empty String too', () => {
      assert.deepEqual(outputsOf('print("");'), [str('')]);
    });

    it('emits once per call, in order', () => {
      assert.deepEqual(outputsOf('print("a"); print("b"); print("c");'), [str('a'), str('b'), str('c')]);
    });

    it('interpolates before emitting — the sink sees the finished String', () => {
      assert.deepEqual(outputsOf('fix n = 3; print("n is ${n}");'), [str('n is 3')]);
    });

    it('yields Done, so a lone print emits only its argument (no trailing value)', () => {
      assert.deepEqual(outputsOf('print("only");'), [str('only')]);
    });
  });

  describe('alongside the program\'s final value', () => {
    it('emits prints first, then the final value', () => {
      assert.deepEqual(outputsOf('print("side"); 42;'), [str('side'), int(42n)]);
    });

    it('emits the final value on its own when nothing prints', () => {
      assert.deepEqual(outputsOf('1 + 2;'), [int(3n)]);
    });

    it('emits nothing when the program ends in a Done-valued statement and never prints', () => {
      assert.deepEqual(outputsOf('mut x = 1;'), []);
    });
  });

  describe('type errors', () => {
    it('rejects a non-String argument (T0008)', () => {
      assert.deepEqual(errorCodes('print(42);'), ['T0008']);
    });

    it('rejects a missing argument (T0007)', () => {
      assert.deepEqual(errorCodes('print();'), ['T0007']);
    });

    it('rejects an extra argument (T0007)', () => {
      assert.deepEqual(errorCodes('print("a", "b");'), ['T0007']);
    });

    it('no longer knows floor — it was replaced by print (T0013)', () => {
      assert.deepEqual(errorCodes('floor(1.0);'), ['T0013']);
    });
  });
});
