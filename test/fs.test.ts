import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import type { Host, Capabilities } from '../src/host.js';
import { testHost, testCapabilities } from './support/test-host.js';

// Same harness as prelude.test.ts, extended with testHost's in-memory `files`
// (path -> content) so 'readLines' can be exercised without touching disk.
async function run(src: string, files: Readonly<Record<string, string>> = {}): Promise<RuntimeValue> {
  const { program, diagnostics } = parse(src, testCapabilities);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost(() => { }, [], files));
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

async function evalCrash(src: string, files: Readonly<Record<string, string>> = {}): Promise<string> {
  const { program, diagnostics } = parse(src, testCapabilities);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost(() => { }, [], files));
  assert.equal(result.kind, 'error');
  if (result.kind !== 'error') throw new Error('unreachable');
  return result.error.marker.code;
}

function errorCodes(src: string): string[] {
  return parse(src, testCapabilities).diagnostics.map(d => d.code);
}

const strList = (...values: string[]): RuntimeValue => ({ type: 'List', elements: values.map(value => ({ type: 'String', value })) });
const IMPORT = 'import { readLines } from "fs";\n';

describe('fs module — readLines (end-to-end)', () => {
  describe('reading', () => {
    it('splits file content into lines, no trailing terminators', async () => {
      const src = `${IMPORT}match await readLines!("a.txt") { Success{ value } -> value, Failure{ error } -> [] };`;
      assert.deepEqual(await run(src, { 'a.txt': 'one\ntwo\nthree\n' }), strList('one', 'two', 'three'));
    });

    it('does not add a phantom empty line for a file with no trailing newline', async () => {
      const src = `${IMPORT}match await readLines!("a.txt") { Success{ value } -> value, Failure{ error } -> [] };`;
      assert.deepEqual(await run(src, { 'a.txt': 'one\ntwo' }), strList('one', 'two'));
    });

    it('yields zero lines for an empty file', async () => {
      const src = `${IMPORT}match await readLines!("a.txt") { Success{ value } -> value, Failure{ error } -> ["should not happen"] };`;
      assert.deepEqual(await run(src, { 'a.txt': '' }), { type: 'List', elements: [] });
    });

    it('strips a trailing \\r (CRLF line endings)', async () => {
      const src = `${IMPORT}match await readLines!("a.txt") { Success{ value } -> value, Failure{ error } -> [] };`;
      assert.deepEqual(await run(src, { 'a.txt': 'one\r\ntwo\r\n' }), strList('one', 'two'));
    });

    it('a missing file is a Failure, not a crash', async () => {
      const src = `${IMPORT}match await readLines!("missing.txt") { Success{ value } -> "ok", Failure{ error } -> error };`;
      assert.deepEqual(await run(src, {}), { type: 'String', value: 'no such file: missing.txt' });
    });

    it("composes with 'try' inside an async fn, per the whitepaper's own example", async () => {
      const src = `${IMPORT}`
        + 'fix f = async fn(): List<String> orfail String { fix lines = try await readLines!("a.txt"); Success{ value: lines } };'
        + 'match await f!() { Success{ value } -> value, Failure{ error } -> [] };';
      assert.deepEqual(await run(src, { 'a.txt': 'x\ny\n' }), strList('x', 'y'));
    });

    it("'try' propagates a Failure out of the async fn unchanged", async () => {
      const src = `${IMPORT}`
        + 'fix f = async fn(): List<String> orfail String { fix lines = try await readLines!("missing.txt"); Success{ value: lines } };'
        + 'match await f!() { Success{ value } -> "ok", Failure{ error } -> error };';
      assert.deepEqual(await run(src, {}), { type: 'String', value: 'no such file: missing.txt' });
    });
  });

  describe('is inert until awaited — preparing it never touches the host', () => {
    it('does not call readLines until the Task is awaited', async () => {
      let calls = 0;
      const host: Host = {
        capabilities: {
          console: { write: () => { }, writeInline: () => { }, askText: async () => null, askInt: async () => null, askFloat: async () => null, askBool: async () => null },
          fs: { readLines: async () => { calls++; return { ok: true, value: [] }; } },
        },
      };
      const { program, diagnostics } = parse(`${IMPORT}fix t = readLines!("a.txt"); print("prepared");`, testCapabilities);
      assert.deepEqual(diagnostics, []);
      assert.ok(program !== null);
      await executeProgram(program, host);
      assert.equal(calls, 0);
    });
  });

  describe('a runtime host missing fs, despite being declared available at check time', () => {
    it('crashes (R0014) rather than a raw property-access error', async () => {
      const bareHost: Host = {
        capabilities: {
          console: { write: () => { }, writeInline: () => { }, askText: async () => null, askInt: async () => null, askFloat: async () => null, askBool: async () => null },
        },
      };
      const { program, diagnostics } = parse(`${IMPORT}await readLines!("a.txt");`, testCapabilities);
      assert.deepEqual(diagnostics, []);
      assert.ok(program !== null);
      const result = await executeProgram(program, bareHost);
      assert.equal(result.kind, 'error');
      if (result.kind !== 'error') throw new Error('unreachable');
      assert.equal(result.error.marker.code, 'R0014');
    });
  });

  describe('capability gating at check time (N0018)', () => {
    // A capability set with no 'fs' at all — what parse()/typecheck() are
    // told this program will run under, independent of any actual Host.
    const noFsCapabilities: Capabilities = { console: testCapabilities.console };

    it('rejects importing "fs" when the declared capabilities do not include it', () => {
      // A later use of the unregistered name cascades into T0013 ("no such
      // function") — the same cascade an unknown module (N0014) already
      // produces; N0018 is still the first, load-bearing diagnostic.
      const { diagnostics } = parse(`${IMPORT}fix t = readLines!("a.txt");`, noFsCapabilities);
      assert.deepEqual(diagnostics.map(d => d.code), ['N0018', 'T0013']);
    });

    it('reports only N0018 when nothing afterward tries to use the import', () => {
      const { diagnostics } = parse(IMPORT, noFsCapabilities);
      assert.deepEqual(diagnostics.map(d => d.code), ['N0018']);
    });

    it('still resolves "fs" cleanly when the declared capabilities do include it', () => {
      const { diagnostics } = parse(`${IMPORT}fix t = readLines!("a.txt");`, testCapabilities);
      assert.deepEqual(diagnostics, []);
    });

    it('does not gate a module with no required capability (math)', () => {
      const { diagnostics } = parse('import { min } from "math"; min(1, 2);', noFsCapabilities);
      assert.deepEqual(diagnostics, []);
    });
  });

  describe('import validation', () => {
    it('resolves the module and its export with no errors', () => {
      assert.deepEqual(errorCodes(`${IMPORT}fix t = readLines!("a.txt");`), []);
    });

    it('rejects an unknown export from "fs" (N0015)', () => {
      assert.deepEqual(errorCodes('import { oops } from "fs";'), ['N0015']);
    });
  });

  describe('the async color is enforced, same as the prompt family', () => {
    it('rejects a bare call — no ! (T0053)', () => {
      assert.deepEqual(errorCodes(`${IMPORT}readLines("a.txt");`), ['T0053']);
    });

    it('rejects a bare name used as a value (N0017)', () => {
      assert.deepEqual(errorCodes(`${IMPORT}fix f = readLines;`), ['N0017']);
    });

    it('rejects a wrong argument type (T0015)', () => {
      assert.deepEqual(errorCodes(`${IMPORT}readLines!(42);`), ['T0015']);
    });

    it('rejects a missing argument (T0014)', () => {
      assert.deepEqual(errorCodes(`${IMPORT}readLines!();`), ['T0014']);
    });
  });
});
