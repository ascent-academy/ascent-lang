import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue.
function evalOk(src: string): RuntimeValue {
  const { program, errorMarkers } = parse(src);
  assert.deepEqual(errorMarkers, [], `unexpected errors: ${errorMarkers.map(m => m.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program);
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

// Runs a program expected to typecheck but crash at runtime, returning the
// RuntimeError's code.
function evalCrash(src: string): string {
  const { program, errorMarkers } = parse(src);
  assert.deepEqual(errorMarkers, [], `unexpected errors: ${errorMarkers.map(m => m.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program);
  assert.equal(result.kind, 'error');
  if (result.kind !== 'error') throw new Error('unreachable');
  return result.error.marker.code;
}

function errorCodes(src: string): string[] {
  return parse(src).errorMarkers.map(m => m.code);
}

describe('String methods (end-to-end)', () => {
  describe('.length()', () => {
    it('counts characters, not bytes or code units', () => {
      assert.deepEqual(evalOk('"hello".length();'), { type: 'Int', value: 5n });
    });

    it('counts a combining-accent grapheme as one character', () => {
      assert.deepEqual(evalOk('"é".length();'), { type: 'Int', value: 1n });
    });

    it('is 0 for an empty String', () => {
      assert.deepEqual(evalOk('"".length();'), { type: 'Int', value: 0n });
    });
  });

  describe('.first() / .last()', () => {
    it('returns the first and last character as length-1 Strings', () => {
      assert.deepEqual(evalOk('"hello".first();'), { type: 'String', value: 'h' });
      assert.deepEqual(evalOk('"hello".last();'), { type: 'String', value: 'o' });
    });

    it('returns the same length-1 String from a single-character receiver', () => {
      assert.deepEqual(evalOk('"x".first();'), { type: 'String', value: 'x' });
      assert.deepEqual(evalOk('"x".last();'), { type: 'String', value: 'x' });
    });

    it('crashes with R0006 on an empty String', () => {
      assert.equal(evalCrash('"".first();'), 'R0006');
      assert.equal(evalCrash('"".last();'), 'R0006');
    });
  });

  describe('.chars()', () => {
    it('splits into a List of length-1 Strings', () => {
      assert.deepEqual(evalOk('"abc".chars();'), {
        type: 'List',
        elements: [
          { type: 'String', value: 'a' },
          { type: 'String', value: 'b' },
          { type: 'String', value: 'c' },
        ],
      });
    });

    it('is an empty List for an empty String', () => {
      assert.deepEqual(evalOk('"".chars();'), { type: 'List', elements: [] });
    });
  });

  describe('.slice(start, end)', () => {
    it('takes a half-open substring', () => {
      assert.deepEqual(evalOk('"hello".slice(1, 4);'), { type: 'String', value: 'ell' });
    });

    it('returns the whole String when the range spans it', () => {
      assert.deepEqual(evalOk('"hello".slice(0, 5);'), { type: 'String', value: 'hello' });
    });

    it('returns an empty String when start equals end', () => {
      assert.deepEqual(evalOk('"hello".slice(2, 2);'), { type: 'String', value: '' });
    });

    it('crashes with R0007 when the end exceeds the length', () => {
      assert.equal(evalCrash('"hello".slice(0, 6);'), 'R0007');
    });

    it('crashes with R0007 when the start is negative', () => {
      assert.equal(evalCrash('"hello".slice(-1, 3);'), 'R0007');
    });

    it('crashes with R0007 when the start exceeds the end', () => {
      assert.equal(evalCrash('"hello".slice(3, 1);'), 'R0007');
    });
  });

  describe('.toString() (renamed from .toStr())', () => {
    it('converts an Int to its decimal digits', () => {
      assert.deepEqual(evalOk('42.toString();'), { type: 'String', value: '42' });
    });

    it('converts a Float, keeping the decimal point on a whole number', () => {
      assert.deepEqual(evalOk('3.0.toString();'), { type: 'String', value: '3.0' });
    });
  });

  it('reports T0006 for the old .toStr() name, which no longer exists', () => {
    assert.deepEqual(errorCodes('42.toStr();'), ['T0006']);
  });
});
