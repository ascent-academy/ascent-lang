import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost, testCapabilities } from './support/test-host.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue. Output is streamed to a sink we discard here —
// these tests assert on the structured value executeProgram returns, not its text.
async function evalOk(src: string): Promise<RuntimeValue> {
  const { program, diagnostics } = parse(src, testCapabilities);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

// Runs a program expected to typecheck but crash at runtime, returning the
// RuntimeError's code. Output is discarded — only the crash matters here.
async function evalCrash(src: string): Promise<string> {
  const { program, diagnostics } = parse(src, testCapabilities);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost());
  assert.equal(result.kind, 'error');
  if (result.kind !== 'error') throw new Error('unreachable');
  return result.error.marker.code;
}

function errorCodes(src: string): string[] {
  return parse(src, testCapabilities).diagnostics.map(d => d.code);
}

describe('String methods (end-to-end)', () => {
  describe('.length()', () => {
    it('counts characters, not bytes or code units', async () => {
      assert.deepEqual(await evalOk('"hello".length();'), { type: 'Int', value: 5n });
    });

    it('counts a combining-accent grapheme as one character', async () => {
      assert.deepEqual(await evalOk('"é".length();'), { type: 'Int', value: 1n });
    });

    it('is 0 for an empty String', async () => {
      assert.deepEqual(await evalOk('"".length();'), { type: 'Int', value: 0n });
    });
  });

  describe('.first() / .last()', () => {
    it('returns the first and last character as length-1 Strings', async () => {
      assert.deepEqual(await evalOk('"hello".first();'), { type: 'String', value: 'h' });
      assert.deepEqual(await evalOk('"hello".last();'), { type: 'String', value: 'o' });
    });

    it('returns the same length-1 String from a single-character receiver', async () => {
      assert.deepEqual(await evalOk('"x".first();'), { type: 'String', value: 'x' });
      assert.deepEqual(await evalOk('"x".last();'), { type: 'String', value: 'x' });
    });

    it('returns None instead of crashing on an empty String', async () => {
      assert.deepEqual(await evalOk('"".first();'), { type: 'None' });
      assert.deepEqual(await evalOk('"".last();'), { type: 'None' });
    });

    it('type-checks as String? — assignable to a String? slot and comparable to None', async () => {
      assert.deepEqual(await evalOk('fix c: String? = "hi".first(); c;'), { type: 'String', value: 'h' });
      assert.deepEqual(await evalOk('"".first() == None;'), { type: 'Bool', value: true });
      assert.deepEqual(await evalOk('"hi".first() == None;'), { type: 'Bool', value: false });
    });
  });

  describe('.chars()', () => {
    it('splits into a List of length-1 Strings', async () => {
      assert.deepEqual(await evalOk('"abc".chars();'), {
        type: 'List',
        elements: [
          { type: 'String', value: 'a' },
          { type: 'String', value: 'b' },
          { type: 'String', value: 'c' },
        ],
      });
    });

    it('is an empty List for an empty String', async () => {
      assert.deepEqual(await evalOk('"".chars();'), { type: 'List', elements: [] });
    });
  });

  describe('.slice(range)', () => {
    it('takes a half-open substring', async () => {
      assert.deepEqual(await evalOk('"hello".slice(1..4);'), { type: 'String', value: 'ell' });
    });

    it('returns the whole String when the range spans it', async () => {
      assert.deepEqual(await evalOk('"hello".slice(0..5);'), { type: 'String', value: 'hello' });
    });

    it('returns an empty String when start equals end', async () => {
      assert.deepEqual(await evalOk('"hello".slice(2..2);'), { type: 'String', value: '' });
    });

    it('crashes with R0006 when the end exceeds the length', async () => {
      assert.equal(await evalCrash('"hello".slice(0..6);'), 'R0006');
    });

    it('crashes with R0006 when the start is negative', async () => {
      assert.equal(await evalCrash('"hello".slice(-1..3);'), 'R0006');
    });

    it('crashes with R0006 when the start exceeds the end', async () => {
      assert.equal(await evalCrash('"hello".slice(3..1);'), 'R0006');
    });
  });

  describe('.repeat(n)', () => {
    it('concatenates n copies of the String', async () => {
      assert.deepEqual(await evalOk('"ab".repeat(3);'), { type: 'String', value: 'ababab' });
    });

    it('returns an empty String for a count of 0', async () => {
      assert.deepEqual(await evalOk('"ab".repeat(0);'), { type: 'String', value: '' });
    });

    it('crashes with R0007 for a negative count', async () => {
      assert.equal(await evalCrash('"ab".repeat(-1);'), 'R0007');
    });
  });

  describe('.trim()', () => {
    it('removes leading and trailing whitespace', async () => {
      assert.deepEqual(await evalOk('"  hi there  ".trim();'), { type: 'String', value: 'hi there' });
    });

    it('leaves internal whitespace untouched', async () => {
      assert.deepEqual(await evalOk('"  a  b  ".trim();'), { type: 'String', value: 'a  b' });
    });

    it('is unchanged for a String with no surrounding whitespace', async () => {
      assert.deepEqual(await evalOk('"hi".trim();'), { type: 'String', value: 'hi' });
    });
  });

  describe('.padLeft(n)', () => {
    it('pads with spaces on the left up to length n', async () => {
      assert.deepEqual(await evalOk('"7".padLeft(3);'), { type: 'String', value: '  7' });
    });

    it('returns the String unchanged when it is already at least n characters', async () => {
      assert.deepEqual(await evalOk('"hello".padLeft(3);'), { type: 'String', value: 'hello' });
    });

    it('counts characters (graphemes), not bytes or code units', async () => {
      assert.deepEqual(await evalOk('"é".padLeft(3);'), { type: 'String', value: '  é' });
    });
  });

  describe('.toString() (renamed from .toStr())', () => {
    it('converts an Int to its decimal digits', async () => {
      assert.deepEqual(await evalOk('42.toString();'), { type: 'String', value: '42' });
    });

    it('converts a Float, keeping the decimal point on a whole number', async () => {
      assert.deepEqual(await evalOk('3.0.toString();'), { type: 'String', value: '3.0' });
    });
  });

  it('reports T0012 for the old .toStr() name, which no longer exists', async () => {
    assert.deepEqual(errorCodes('42.toStr();'), ['T0012']);
  });
});
