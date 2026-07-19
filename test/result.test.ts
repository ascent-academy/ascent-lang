import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost, testCapabilities } from './support/test-host.js';
import type { Marker } from '../src/lexer/token.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its last
// statement's RuntimeValue. Mirrors the harness in optional.test.ts / records.test.ts.
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
// RuntimeError marker (code + data). Mirrors the harness in abort.test.ts.
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

// A tiny error type reused across the value tests.
const E = 'type E = { msg: String };\n';

describe('Result (T orfail E) (end-to-end)', () => {
  describe('construction and match', () => {
    it("matches a Success and pulls its 'value' out", async () => {
      const src = `${E}fix r: Int orfail E = Success{ value: 7 }; match r { Success{ value } -> value, Failure{ error } -> 0 };`;
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 7n });
    });

    it("matches a Failure and pulls its 'error' out", async () => {
      const src = `${E}fix r: Int orfail E = Failure{ error: E{ msg: "boom" } }; match r { Success{ value } -> "ok", Failure{ error } -> error.msg };`;
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'boom' });
    });

    it('a function that returns one or the other joins to the whole Result', async () => {
      const src = `${E}`
        + 'fix f = fn(b: Bool): Int orfail E { if (b) { Success{ value: 1 } } else { Failure{ error: E{ msg: "no" } } } };'
        + 'match f(True) { Success{ value } -> value, Failure{ error } -> 0 };';
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 1n });
      const src2 = `${E}`
        + 'fix f = fn(b: Bool): Int orfail E { if (b) { Success{ value: 1 } } else { Failure{ error: E{ msg: "no" } } } };'
        + 'match f(False) { Success{ value } -> value, Failure{ error } -> 0 };';
      assert.deepEqual(await evalOk(src2), { type: 'Int', value: 0n });
    });

    it('an else arm covers the remaining Result case', async () => {
      const src = `${E}fix r: Int orfail E = Failure{ error: E{ msg: "x" } }; match r { Success{ value } -> value, else -> 99 };`;
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 99n });
    });

    it('a bare Success tag pattern matches without binding fields', async () => {
      const src = `${E}fix r: Int orfail E = Success{ value: 3 }; match r { Success -> "won", Failure -> "lost" };`;
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'won' });
    });
  });

  describe('widening inside a Result', () => {
    it('widens a Success Int payload into a Float ok slot', async () => {
      // Success{ value: 5 } is Result<Int, Never>; the annotation supplies Float.
      const src = `${E}fix r: Float orfail E = Success{ value: 5 }; match r { Success{ value } -> value, Failure{ error } -> 0.0 };`;
      assert.deepEqual(await evalOk(src), { type: 'Float', value: 5 });
    });

    it('widens a bare Success/Failure into the declared error/ok side (Never widens away)', async () => {
      const src = `${E}fix ok: Int orfail E = Success{ value: 1 }; fix bad: Int orfail E = Failure{ error: E{ msg: "e" } }; match bad { Success{ value } -> value, Failure{ error } -> 2 };`;
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 2n });
    });
  });

  describe('exhaustiveness', () => {
    it('reports T0031 when the Failure case is missing', async () => {
      const src = `${E}fix r: Int orfail E = Success{ value: 1 }; match r { Success{ value } -> value };`;
      assert.deepEqual(errorCodes(src), ['T0031']);
    });

    it('reports T0031 when the Success case is missing', async () => {
      const src = `${E}fix r: Int orfail E = Success{ value: 1 }; match r { Failure{ error } -> 0 };`;
      assert.deepEqual(errorCodes(src), ['T0031']);
    });

    it('accepts a match that lists both cases', async () => {
      const src = `${E}fix r: Int orfail E = Success{ value: 1 }; match r { Success{ value } -> value, Failure{ error } -> 0 };`;
      assert.deepEqual(errorCodes(src), []);
    });

    it('reports T0033 for an else after both cases are already covered', async () => {
      const src = `${E}fix r: Int orfail E = Success{ value: 1 }; match r { Success{ value } -> value, Failure{ error } -> 0, else -> 9 };`;
      assert.deepEqual(errorCodes(src), ['T0033']);
    });
  });

  describe('slot inference needs an annotation', () => {
    it('reports T0048 for a bare Success with no annotation', async () => {
      assert.deepEqual(errorCodes('fix r = Success{ value: 1 };'), ['T0048']);
    });

    it('reports T0048 for a bare Failure with no annotation', async () => {
      assert.deepEqual(errorCodes(`${E}fix r = Failure{ error: E{ msg: "x" } };`), ['T0048']);
    });
  });

  describe('rejections', () => {
    it("reports T0044 — '??' is not allowed on a Result", async () => {
      const src = `${E}fix r: Int orfail E = Success{ value: 1 }; fix x = r ?? 0;`;
      assert.deepEqual(errorCodes(src), ['T0044']);
    });

    it('reports T0034 — a Result cannot be destructured in a fix binding', async () => {
      const src = `${E}fix r: Int orfail E = Success{ value: 1 }; fix Success{ value } = r;`;
      assert.deepEqual(errorCodes(src), ['T0034']);
    });

    it('reports T0029 — a Result pattern on a non-Result subject', async () => {
      const src = 'match 5 { Success{ value } -> value, else -> 0 };';
      assert.deepEqual(errorCodes(src), ['T0029']);
    });

    it('reports T0023 (+T0022) for a wrong field name on Success', async () => {
      assert.deepEqual(errorCodes('fix r: Int orfail Int = Success{ foo: 1 };'), ['T0023', 'T0022']);
    });

    it('reports T0022 for a Success built with no value', async () => {
      assert.deepEqual(errorCodes('fix r: Int orfail Int = Success{};'), ['T0022']);
    });

    it('reports T0001 when the Success payload does not fit the ok type', async () => {
      const src = `${E}fix r: String orfail E = Success{ value: 1 };`;
      assert.deepEqual(errorCodes(src), ['T0001']);
    });

    it('reports N0008 for redeclaring Result / Success / Failure', async () => {
      assert.deepEqual(errorCodes('type Result = { a: Int };'), ['N0008']);
      assert.deepEqual(errorCodes('type Success = { a: Int };'), ['N0008']);
      assert.deepEqual(errorCodes('type Failure = { a: Int };'), ['N0008']);
    });
  });
});

describe('try / try … else (end-to-end)', () => {
  // A fallible helper: Success{ value: n } unless b, else Failure{ error: E }.
  const helper = `${E}fix g = fn(b: Bool, n: Int): Int orfail E `
    + '{ if (b) { Failure{ error: E{ msg: "bad" } } } else { Success{ value: n } } };\n';

  describe('plain try (propagate unchanged)', () => {
    it('unwraps a Success and continues', async () => {
      const src = helper
        + 'fix f = fn(): Int orfail E { fix v = try g(False, 5); Success{ value: v * 2 } };'
        + 'match f() { Success{ value } -> value, Failure{ error } -> -1 };';
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 10n });
    });

    it('early-returns the Failure from the enclosing function', async () => {
      const src = helper
        + 'fix f = fn(): Int orfail E { fix v = try g(True, 5); Success{ value: v * 2 } };'
        + 'match f() { Success{ value } -> value, Failure{ error } -> -1 };';
      assert.deepEqual(await evalOk(src), { type: 'Int', value: -1n });
    });

    it('unwraps a present Optional (String.first) and propagates None', async () => {
      const src = 'fix firstChar = fn(s: String): String? { fix c = try s.first(); "[${c}]" };'
        + 'match firstChar("hi") { None -> "none", txt -> txt };';
      assert.deepEqual(await evalOk(src), { type: 'String', value: '[h]' });
      const src2 = 'fix firstChar = fn(s: String): String? { fix c = try s.first(); "[${c}]" };'
        + 'match firstChar("") { None -> "none", txt -> txt };';
      assert.deepEqual(await evalOk(src2), { type: 'String', value: 'none' });
    });

    it('widens the propagated error (Int orfail Int through Int orfail Float)', async () => {
      const src = 'fix g = fn(b: Bool): Int orfail Int { if (b) { Failure{ error: 3 } } else { Success{ value: 7 } } };'
        + 'fix f = fn(b: Bool): Int orfail Float { fix v = try g(b); Success{ value: v } };'
        + 'match f(True) { Success{ value } -> value, Failure{ error } -> error };';
      // the propagated Int error widens to a Float on the way out
      assert.deepEqual(await evalOk(src), { type: 'Float', value: 3 });
    });
  });

  describe('try … else (map the error)', () => {
    it('adapts a Result error into the function’s declared error type', async () => {
      const src = `${E}type F = { code: Int };`
        + 'fix g = fn(b: Bool): Int orfail E { if (b) { Failure{ error: E{ msg: "x" } } } else { Success{ value: 4 } } };'
        + 'fix f = fn(b: Bool): Int orfail F { fix v = try g(b) else e -> F{ code: 9 }; Success{ value: v } };'
        + 'match f(True) { Success{ value } -> value, Failure{ error } -> error.code };';
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 9n });
    });

    it('binds the original error so the new one can carry it', async () => {
      const src = `${E}type W = { inner: E };`
        + 'fix g = fn(): Int orfail E { Failure{ error: E{ msg: "deep" } } };'
        + 'fix f = fn(): Int orfail W { fix v = try g() else e -> W{ inner: e }; Success{ value: v } };'
        + 'match f() { Success{ value } -> "ok", Failure{ error } -> error.inner.msg };';
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'deep' });
    });

    it('turns an Optional None into a propagated Failure (no binding)', async () => {
      const src = `${E}`
        + 'fix need = fn(s: String): String orfail E { fix c = try s.first() else -> E{ msg: "empty" }; Success{ value: c } };'
        + 'match need("") { Success{ value } -> value, Failure{ error } -> error.msg };';
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'empty' });
      const src2 = `${E}`
        + 'fix need = fn(s: String): String orfail E { fix c = try s.first() else -> E{ msg: "empty" }; Success{ value: c } };'
        + 'match need("hi") { Success{ value } -> value, Failure{ error } -> error.msg };';
      assert.deepEqual(await evalOk(src2), { type: 'String', value: 'h' });
    });
  });

  describe('rejections', () => {
    it('reports T0050 — try on a value that cannot fail', async () => {
      assert.deepEqual(errorCodes('fix f = fn(x: Int): Int { fix y = try x; y };'), ['T0050']);
    });

    it('reports T0051 — the enclosing function cannot carry the failure', async () => {
      const src = `${E}fix g = fn(): Int orfail E { Failure{ error: E{ msg: "x" } } };`
        + 'fix f = fn(): Int { fix y = try g(); y };';
      assert.deepEqual(errorCodes(src), ['T0051']);
    });

    it('reports T0051 — plain try on an Optional inside a Result-returning function', async () => {
      const src = `${E}fix f = fn(s: String): Int orfail E { fix c = try s.first(); Success{ value: 1 } };`;
      assert.deepEqual(errorCodes(src), ['T0051']);
    });

    it('reports T0052 — try … else binds an error name on an Optional', async () => {
      const src = `${E}fix f = fn(s: String): String orfail E { fix c = try s.first() else e -> E{ msg: "x" }; Success{ value: c } };`;
      assert.deepEqual(errorCodes(src), ['T0052']);
    });
  });
});

describe('top-level try (end-to-end)', () => {
  // A fallible helper reused across these tests: Success{ value: n } unless b,
  // else Failure{ error: E }.
  const helper = `${E}fix g = fn(b: Bool, n: Int): Int orfail E `
    + '{ if (b) { Failure{ error: E{ msg: "bad" } } } else { Success{ value: n } } };\n';

  it('typechecks with no T0049 — try is allowed outside any function', async () => {
    const src = `${E}fix g = fn(): Int orfail E { Success{ value: 1 } }; fix x = try g();`;
    assert.deepEqual(errorCodes(src), []);
  });

  it('unwraps a Success/present value and continues, same as inside a function', async () => {
    assert.deepEqual(await evalOk(`${helper}(try g(False, 5)) * 2;`), { type: 'Int', value: 10n });
    assert.deepEqual(await evalOk('try "hi".first();'), { type: 'String', value: 'h' });
  });

  it('crashes (R0015) on a Failure, reporting the carried error', async () => {
    const marker = await evalCrash(`${helper}try g(True, 5);`);
    assert.equal(marker.code, 'R0015');
    assert.equal(marker.data?.error, 'E{ msg: bad }');
  });

  it('crashes (R0016) on a None', async () => {
    const marker = await evalCrash('try "".first();');
    assert.equal(marker.code, 'R0016');
  });

  it("crashes (R0015) on a 'try … else', reporting the mapped error", async () => {
    const src = helper + 'try g(True, 5) else e -> "mapped: ${e.msg}";';
    const marker = await evalCrash(src);
    assert.equal(marker.code, 'R0015');
    assert.equal(marker.data?.error, 'mapped: bad');
  });

  it('crashes (R0015) on a None through a try … else (no binding)', async () => {
    const src = 'try "".first() else -> "was empty";';
    const marker = await evalCrash(src);
    assert.equal(marker.code, 'R0015');
    assert.equal(marker.data?.error, 'was empty');
  });

  it('works nested inside top-level control flow (if), not just at the very top', async () => {
    const src = `${helper}if (True) { try g(True, 5) } else { 0 };`;
    const marker = await evalCrash(src);
    assert.equal(marker.code, 'R0015');
  });
});
