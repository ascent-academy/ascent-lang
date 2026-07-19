import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost, testCapabilities } from './support/test-host.js';
import { elaborate } from '../src/errors/elaborate.js';
import type { Marker } from '../src/lexer/token.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its last
// statement's RuntimeValue. Mirrors the harness in result.test.ts / string-methods.test.ts.
async function evalOk(src: string): Promise<RuntimeValue> {
  const { program, diagnostics } = parse(src, testCapabilities);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

// Runs a program expected to typecheck but crash at runtime, returning the raw
// RuntimeError marker (code + data), so a test can assert on both the code and
// the values it will render (the reason, the reported error, the context).
async function evalCrash(src: string): Promise<Marker> {
  const { program, diagnostics } = parse(src, testCapabilities);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost());
  assert.equal(result.kind, 'error');
  if (result.kind !== 'error') throw new Error('unreachable');
  return result.error.marker;
}

function errorCodes(src: string): string[] {
  return parse(src, testCapabilities).diagnostics.map(d => d.code);
}

// A tiny error type reused across the Result tests.
const E = 'type E = { msg: String };\n';

describe('abort (end-to-end)', () => {
  describe('as a diverging expression (type Never)', () => {
    it("satisfies its neighbour's type in a match arm", async () => {
      // The abort arm is Never, which is assignable to the Int the other arm
      // yields — so the whole match is Int (whitepaper §7).
      const src = 'fix pick = fn(b: Bool): Int => { match b { True -> 1, False -> abort "unreachable" } }; pick(True);';
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 1n });
    });

    it('satisfies its neighbour in an if branch', async () => {
      const src = 'fix f = fn(n: Int): Int => { if (n > 0) { n } else { abort "must be positive" } }; f(7);';
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 7n });
    });

    it('lets a value-position abort stand where any type is expected', async () => {
      const src = 'fix label = fn(b: Bool): String => { if (b) { "yes" } else { abort "no case" } }; label(True);';
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'yes' });
    });
  });

  describe('runtime crash (R0008)', () => {
    it('aborts with the written reason', async () => {
      const marker = await evalCrash('fix f = fn(b: Bool): Int => { if (b) { 1 } else { abort "hit the impossible branch" } }; f(False);');
      assert.equal(marker.code, 'R0008');
      assert.equal(marker.data?.reason, 'hit the impossible branch');
    });

    it('reports an interpolated reason with its runtime values filled in', async () => {
      const marker = await evalCrash('fix f = fn(n: Int): Int => { if (n > 0) { n } else { abort "n was ${n}, expected positive" } }; f(0);');
      assert.equal(marker.code, 'R0008');
      assert.equal(marker.data?.reason, 'n was 0, expected positive');
    });

    it("the rendered message carries the reason, not the source '{found}'", async () => {
      const src = 'abort "boom";';
      const marker = await evalCrash(src);
      assert.equal(elaborate(marker, src).message, 'The program aborted: boom');
    });
  });

  describe('reason must be a String (T0060)', () => {
    it('rejects a non-String reason', async () => {
      assert.ok(errorCodes('fix f = fn(b: Bool): Int => { if (b) { 1 } else { abort 42 } }; f(True);').includes('T0060'));
    });

    it('accepts an interpolated String reason', async () => {
      const src = 'fix f = fn(n: Int): Int => { if (n > 0) { n } else { abort "bad: ${n}" } }; f(1);';
      assert.deepEqual(errorCodes(src), []);
    });
  });
});

describe('.orAbort() on Result / Optional (end-to-end)', () => {
  const parseFn = `${E}fix parse = fn(ok: Bool): Int orfail E => { if (ok) { Success{ value: 42 } } else { Failure{ error: E{ msg: "bad input" } } } };\n`;

  describe('Result', () => {
    it('unwraps a Success to its value', async () => {
      assert.deepEqual(await evalOk(`${parseFn}parse(True).orAbort();`), { type: 'Int', value: 42n });
    });

    it('the unwrapped value has the ok type (usable in arithmetic)', async () => {
      assert.deepEqual(await evalOk(`${parseFn}parse(True).orAbort() + 8;`), { type: 'Int', value: 50n });
    });

    it('crashes on a Failure (R0009), reporting the carried error', async () => {
      const marker = await evalCrash(`${parseFn}parse(False).orAbort();`);
      assert.equal(marker.code, 'R0009');
      assert.equal(marker.data?.error, 'E{ msg: bad input }');
      assert.equal(marker.data?.context, '');
    });

    it('augments the crash with an optional message, never replacing the error', async () => {
      const src = `${parseFn}parse(False).orAbort("while loading config");`;
      const marker = await evalCrash(src);
      assert.equal(marker.code, 'R0009');
      assert.equal(marker.data?.context, ' (while loading config)');
      // Both the underlying error and the context appear in the rendered message.
      const message = elaborate(marker, src).message;
      assert.ok(message.includes('bad input'), message);
      assert.ok(message.includes('while loading config'), message);
    });
  });

  describe('Optional', () => {
    it('unwraps a present value', async () => {
      assert.deepEqual(await evalOk('"hello".first().orAbort();'), { type: 'String', value: 'h' });
    });

    it('crashes on None (R0010)', async () => {
      const marker = await evalCrash('"".first().orAbort();');
      assert.equal(marker.code, 'R0010');
      assert.equal(marker.data?.context, '');
    });

    it('carries the optional message on a None crash', async () => {
      const marker = await evalCrash('"".first().orAbort("reading the head");');
      assert.equal(marker.code, 'R0010');
      assert.equal(marker.data?.context, ' (reading the head)');
    });
  });

  describe('type errors', () => {
    it('rejects more than one message argument (T0014)', async () => {
      assert.ok(errorCodes('"hi".first().orAbort("a", "b");').includes('T0014'));
    });

    it('rejects a non-String message (T0015)', async () => {
      assert.ok(errorCodes('"hi".first().orAbort(42);').includes('T0015'));
    });

    it("reports another method on a Result as T0012, not T0011 ('no methods')", async () => {
      const codes = errorCodes(`${E}fix r: Int orfail E = Success{ value: 1 }; r.length();`);
      assert.ok(codes.includes('T0012'), codes.join(', '));
      assert.ok(!codes.includes('T0011'), codes.join(', '));
    });

    it('reports another method on an Optional as T0012', async () => {
      assert.ok(errorCodes('"hi".first().length();').includes('T0012'));
    });
  });
});
