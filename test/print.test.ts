import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';

// Runs a clean program, returning both the lines it emitted to the output sink
// (each already rendered to text by the interpreter — every print call, then
// the final value unless it's Done) and the structured final value it returns.
// The two are complementary: the text is what a host displays, the value is the
// programmatic result.
function run(src: string): { output: string[]; value: RuntimeValue } {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const output: string[] = [];
  const result = executeProgram(program, testHost(text => output.push(text)));
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return { output, value: result.value };
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

describe('print (end-to-end)', () => {
  describe('sink output', () => {
    it('emits its String argument to the sink', () => {
      assert.deepEqual(run('print("hi");').output, ['hi']);
    });

    it('emits an empty String too', () => {
      assert.deepEqual(run('print("");').output, ['']);
    });

    it('emits once per call, in order', () => {
      assert.deepEqual(run('print("a"); print("b"); print("c");').output, ['a', 'b', 'c']);
    });

    it('interpolates before emitting — the sink sees the finished text', () => {
      assert.deepEqual(run('fix n = 3; print("n is ${n}");').output, ['n is 3']);
    });

    // print<T: Display> accepts any scalar, rendered by the same canonical text
    // form an interpolation hole uses — so print(x) == print("${x}").
    it('accepts an Int, rendered as its decimal digits', () => {
      assert.deepEqual(run('print(42);').output, ['42']);
    });

    it('accepts a Float, keeping the decimal point', () => {
      assert.deepEqual(run('print(3.0);').output, ['3.0']);
    });

    it('accepts a Bool, rendered as True/False', () => {
      assert.deepEqual(run('print(1 < 2);').output, ['True']);
    });

    it('renders a scalar exactly as interpolating it would', () => {
      assert.deepEqual(run('print(7 * 6);').output, run('print("${7 * 6}");').output);
    });

    it('emits prints first, then the final value as text', () => {
      assert.deepEqual(run('print("side"); 42;').output, ['side', '42']);
    });

    it('emits the final value on its own when nothing prints', () => {
      assert.deepEqual(run('1 + 2;').output, ['3']);
    });

    it('emits nothing when the program ends in a Done-valued statement and never prints', () => {
      assert.deepEqual(run('mut x = 1;').output, []);
    });
  });

  describe('return value', () => {
    it('still returns the structured final value alongside the emitted text', () => {
      assert.deepEqual(run('40 + 2;').value, { type: 'Int', value: 42n });
    });

    it('yields Done for a print call itself (a side effect has no result)', () => {
      assert.deepEqual(run('print("hi");').value, { type: 'Done' });
    });
  });

  describe('type errors', () => {
    it('rejects a value with no text form — a List (T0019)', () => {
      assert.deepEqual(errorCodes('print([1, 2]);'), ['T0019']);
    });

    it('rejects None, which has no text form (T0019)', () => {
      assert.deepEqual(errorCodes('print(None);'), ['T0019']);
    });

    it('rejects a missing argument (T0014)', () => {
      assert.deepEqual(errorCodes('print();'), ['T0014']);
    });

    it('rejects an extra argument (T0014)', () => {
      assert.deepEqual(errorCodes('print("a", "b");'), ['T0014']);
    });

    it('no longer knows floor — it was replaced by print (T0013)', () => {
      assert.deepEqual(errorCodes('floor(1.0);'), ['T0013']);
    });
  });
});
