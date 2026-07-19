import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost, testCapabilities } from './support/test-host.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue. Mirrors the harness in string-methods.test.ts.
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
// RuntimeError's code.
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

describe('scalar methods (end-to-end, docs/version-0.1/stdlib/scalars.md)', () => {
  describe('Int', () => {
    it('.toString() renders decimal digits', async () => {
      assert.deepEqual(await evalOk('42.toString();'), { type: 'String', value: '42' });
      assert.deepEqual(await evalOk('(-7).toString();'), { type: 'String', value: '-7' });
    });

    it('.toFloat() always succeeds (widening)', async () => {
      assert.deepEqual(await evalOk('5.toFloat();'), { type: 'Float', value: 5 });
    });

    it('.abs() returns the same type', async () => {
      assert.deepEqual(await evalOk('(-5).abs();'), { type: 'Int', value: 5n });
      assert.deepEqual(await evalOk('5.abs();'), { type: 'Int', value: 5n });
    });

    it('.abs() crashes (R0001) on the one unrepresentable case, Int.MIN', async () => {
      // Int.MIN built via arithmetic (its literal magnitude alone overflows Int).
      assert.equal(await evalCrash('(-9223372036854775807 - 1).abs();'), 'R0001');
    });
  });

  describe('Float', () => {
    it('.toString() keeps the decimal point on a whole number', async () => {
      assert.deepEqual(await evalOk('3.0.toString();'), { type: 'String', value: '3.0' });
    });

    it('.abs() returns the same type', async () => {
      assert.deepEqual(await evalOk('(-3.5).abs();'), { type: 'Float', value: 3.5 });
    });

    describe('the rounding family (Float -> Int)', () => {
      it('.trunc() rounds toward zero', async () => {
        assert.deepEqual(await evalOk('3.7.trunc();'), { type: 'Int', value: 3n });
        assert.deepEqual(await evalOk('(-3.7).trunc();'), { type: 'Int', value: -3n });
      });

      it('.round() rounds to the nearest, away from zero on a tie', async () => {
        assert.deepEqual(await evalOk('3.7.round();'), { type: 'Int', value: 4n });
        assert.deepEqual(await evalOk('3.4.round();'), { type: 'Int', value: 3n });
        assert.deepEqual(await evalOk('2.5.round();'), { type: 'Int', value: 3n });
        assert.deepEqual(await evalOk('(-2.5).round();'), { type: 'Int', value: -3n });
      });

      it('.floor() rounds toward negative infinity', async () => {
        assert.deepEqual(await evalOk('3.7.floor();'), { type: 'Int', value: 3n });
        assert.deepEqual(await evalOk('(-3.2).floor();'), { type: 'Int', value: -4n });
      });

      it('.ceil() rounds toward positive infinity', async () => {
        assert.deepEqual(await evalOk('3.2.ceil();'), { type: 'Int', value: 4n });
        assert.deepEqual(await evalOk('(-3.7).ceil();'), { type: 'Int', value: -3n });
      });
    });

    it('reports T0012 for the old bare .toInt(), which no longer exists', async () => {
      assert.deepEqual(errorCodes('3.7.toInt();'), ['T0012']);
    });
  });

  describe('Bool', () => {
    it('.toString() renders the literal spelling', async () => {
      assert.deepEqual(await evalOk('True.toString();'), { type: 'String', value: 'True' });
      assert.deepEqual(await evalOk('False.toString();'), { type: 'String', value: 'False' });
    });
  });

  describe('String conversions (fallible, return T?)', () => {
    describe('.toInt()', () => {
      it('parses a valid Int', async () => {
        assert.deepEqual(await evalOk('"42".toInt();'), { type: 'Int', value: 42n });
        assert.deepEqual(await evalOk('"-7".toInt();'), { type: 'Int', value: -7n });
      });

      it('is None on text that is not a whole number', async () => {
        assert.deepEqual(await evalOk('"abc".toInt();'), { type: 'None' });
        assert.deepEqual(await evalOk('"4.2".toInt();'), { type: 'None' });
      });

      it('is None when the number is outside Int range', async () => {
        assert.deepEqual(await evalOk('"99999999999999999999".toInt();'), { type: 'None' });
      });

      it('composes with ?? for a fallback default', async () => {
        assert.deepEqual(await evalOk('"abc".toInt() ?? 0;'), { type: 'Int', value: 0n });
      });
    });

    describe('.toFloat()', () => {
      it('parses a valid Float', async () => {
        assert.deepEqual(await evalOk('"9.99".toFloat();'), { type: 'Float', value: 9.99 });
      });

      it('parses a bare whole number too', async () => {
        assert.deepEqual(await evalOk('"42".toFloat();'), { type: 'Float', value: 42 });
      });

      it('is None on text that is not a number', async () => {
        assert.deepEqual(await evalOk('"abc".toFloat();'), { type: 'None' });
      });
    });

    describe('.toBool()', () => {
      it("parses 'true'/'false'", async () => {
        assert.deepEqual(await evalOk('"true".toBool();'), { type: 'Bool', value: true });
        assert.deepEqual(await evalOk('"false".toBool();'), { type: 'Bool', value: false });
      });

      it('is None on anything else, including the capitalized literal spelling', async () => {
        assert.deepEqual(await evalOk('"True".toBool();'), { type: 'None' });
        assert.deepEqual(await evalOk('"yes".toBool();'), { type: 'None' });
      });
    });
  });
});
