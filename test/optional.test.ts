import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// final output value — its last statement's value, which executeProgram emits
// to the sink (or Done, the one value it doesn't emit, when that's the result).
function evalOk(src: string): RuntimeValue {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const outputs: RuntimeValue[] = [];
  const result = executeProgram(program, v => outputs.push(v));
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return outputs.at(-1) ?? ({ type: 'Done' } as RuntimeValue);
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

describe('Optional (T?) (end-to-end)', () => {
  describe('slots', () => {
    it('accepts None as the initial value of an annotated Optional slot', () => {
      assert.deepEqual(evalOk('mut x: String? = None; x;'), { type: 'None' });
    });

    it('accepts a bare value as the initial value of an annotated Optional slot', () => {
      assert.deepEqual(evalOk('fix x: String? = "hi"; x;'), { type: 'String', value: 'hi' });
    });

    it('lets a mut Optional slot be reassigned between None and a value', () => {
      assert.deepEqual(evalOk('mut x: String? = None; x = "hi"; x;'), { type: 'String', value: 'hi' });
      assert.deepEqual(evalOk('mut x: String? = "hi"; x = None; x;'), { type: 'None' });
    });

    it('widens an Int into a Float? slot, same as a plain Float slot', () => {
      assert.deepEqual(evalOk('fix x: Float? = 5; x;'), { type: 'Float', value: 5 });
    });
  });

  describe('equality against None', () => {
    it('is True when an Optional slot holds None', () => {
      assert.deepEqual(evalOk('fix x: String? = None; x == None;'), { type: 'Bool', value: true });
    });

    it('is False when an Optional slot holds a value', () => {
      assert.deepEqual(evalOk('fix x: String? = "hi"; x == None;'), { type: 'Bool', value: false });
      assert.deepEqual(evalOk('fix x: String? = "hi"; x != None;'), { type: 'Bool', value: true });
    });
  });

  describe('type errors', () => {
    it('reports T0015 for a bare None with no annotation', () => {
      assert.deepEqual(errorCodes('fix x = None;'), ['T0015']);
    });

    it('reports T0001 when None is assigned to a non-Optional slot', () => {
      assert.deepEqual(errorCodes('fix x: String = None;'), ['T0001']);
    });

    it('reports T0001 when the Optional\'s element type does not match', () => {
      assert.deepEqual(errorCodes('fix x: Int? = "hi";'), ['T0001']);
    });

    it('reports T0001 when reassigning a mismatched type into an Optional mut slot', () => {
      assert.deepEqual(errorCodes('mut x: String? = None; x = 5;'), ['T0001']);
    });
  });
});
