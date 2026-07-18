import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue. Output is streamed to a sink we discard here —
// these tests assert on the structured value executeProgram returns, not its text.
function evalOk(src: string): RuntimeValue {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
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

  describe('the ?? default operator', () => {
    it('yields the value when the optional is present', () => {
      assert.deepEqual(evalOk('fix x: String? = "hi"; x ?? "def";'), { type: 'String', value: 'hi' });
    });

    it('yields the default when the optional is None', () => {
      assert.deepEqual(evalOk('fix x: String? = None; x ?? "def";'), { type: 'String', value: 'def' });
    });

    it('accepts a bare None on the left (always falls back)', () => {
      assert.deepEqual(evalOk('None ?? "hi";'), { type: 'String', value: 'hi' });
    });

    it('joins the present value and the default to their common type (Int? ?? Float)', () => {
      // present Int coerces to the Float join type
      assert.deepEqual(evalOk('fix x: Int? = 5; x ?? 0.0;'), { type: 'Float', value: 5 });
      // the default Int coerces to Float too
      assert.deepEqual(evalOk('fix x: Float? = None; x ?? 3;'), { type: 'Float', value: 3 });
    });

    it('chains right-associatively — a ?? b ?? c', () => {
      assert.deepEqual(evalOk('fix a: String? = None; fix b: String? = None; a ?? b ?? "c";'),
        { type: 'String', value: 'c' });
      assert.deepEqual(evalOk('fix a: String? = None; fix b: String? = "b"; a ?? b ?? "c";'),
        { type: 'String', value: 'b' });
    });

    it('works on a method returning an optional (String.first)', () => {
      assert.deepEqual(evalOk('"hello".first() ?? "?";'), { type: 'String', value: 'h' });
      assert.deepEqual(evalOk('"".first() ?? "?";'), { type: 'String', value: '?' });
    });

    it('short-circuits — the default is not evaluated when the optional is present', () => {
      // the default '[1][10]' would crash (index out of bounds) if it ran
      assert.deepEqual(evalOk('fix x: Int? = 5; x ?? [1][10];'), { type: 'Int', value: 5n });
    });

    it('reports T0044 when the left side is not optional', () => {
      assert.deepEqual(errorCodes('fix x: Int = 5; x ?? 0;'), ['T0044']);
    });

    it('reports T0045 when the default type does not fit the optional value', () => {
      assert.deepEqual(errorCodes('fix x: Int? = 5; x ?? "hi";'), ['T0045']);
    });
  });

  describe('type errors', () => {
    it('reports T0002 for a bare None with no annotation', () => {
      assert.deepEqual(errorCodes('fix x = None;'), ['T0002']);
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
