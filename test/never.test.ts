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

describe('Never / List<Never> (end-to-end)', () => {
  describe('an empty list literal with no context', () => {
    it('type-checks on its own (List<Never>), unlike before Never existed', () => {
      assert.deepEqual(evalOk('[].isEmpty();'), { type: 'Bool', value: true });
      assert.deepEqual(evalOk('[].length();'), { type: 'Int', value: 0n });
    });

    it('widens to List<Int> through .append(), since Never widens to any type', () => {
      assert.deepEqual(evalOk('[].append(1);'), { type: 'List', elements: [{ type: 'Int', value: 1n }] });
    });

    it('compares equal to another empty list', () => {
      assert.deepEqual(evalOk('[] == [];'), { type: 'Bool', value: true });
    });

    it('joins with a concretely-typed list across if/else branches', () => {
      assert.deepEqual(
        evalOk('if (True) { [] } else { [1, 2, 3] };'),
        { type: 'List', elements: [] },
      );
      assert.deepEqual(
        evalOk('if (False) { [] } else { [1, 2, 3] };'),
        { type: 'List', elements: [{ type: 'Int', value: 1n }, { type: 'Int', value: 2n }, { type: 'Int', value: 3n }] },
      );
    });
  });

  describe('an annotated slot', () => {
    it('accepts an empty list literal, taking its type from the annotation', () => {
      assert.deepEqual(evalOk('fix xs: List<Int> = []; xs;'), { type: 'List', elements: [] });
    });

    it('lets a mut List<Int> slot grow past an empty starting point', () => {
      assert.deepEqual(
        evalOk('mut xs: List<Int> = []; xs = xs.append(1); xs;'),
        { type: 'List', elements: [{ type: 'Int', value: 1n }] },
      );
    });
  });

  describe('an un-annotated slot', () => {
    it('reports T0003 for a bare [] initializer', () => {
      assert.deepEqual(errorCodes('fix xs = [];'), ['T0003']);
    });

    it('reports T0003 even when the Never is nested (a list of empty lists)', () => {
      assert.deepEqual(errorCodes('fix xs = [[]];'), ['T0003']);
    });

    it('reports T0003 for a value derived from [] with nothing to widen it', () => {
      assert.deepEqual(errorCodes('fix xs = [].reverse();'), ['T0003']);
    });

    it('cannot grow: reassigning a widened value back into the frozen List<Never> slot fails', () => {
      assert.deepEqual(errorCodes('mut xs = []; xs = xs.append(1);'), ['T0003', 'T0001']);
    });
  });
});
