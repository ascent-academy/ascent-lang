import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';

// Same harness as print.test.ts/string-methods.test.ts, extended with scripted
// `input` lines for the prompt family — testHost hands them out one per
// readLine call, in order (test/support/test-host.ts).
async function run(src: string, input: readonly string[] = []): Promise<{ output: string[]; value: RuntimeValue }> {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const output: string[] = [];
  const result = await executeProgram(program, testHost(text => output.push(text), input));
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return { output, value: result.value };
}

async function evalCrash(src: string, input: readonly string[] = []): Promise<string> {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost(() => { }, input));
  assert.equal(result.kind, 'error');
  if (result.kind !== 'error') throw new Error('unreachable');
  return result.error.marker.code;
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

describe('prelude (docs/version-0.1/stdlib/prelude.md, end-to-end)', () => {
  describe('printInline', () => {
    it('emits its argument to the sink, like print', async () => {
      assert.deepEqual((await run('printInline("hi");')).output, ['hi']);
    });

    it('emits several calls in order, unseparated by print (no forced newline between them)', async () => {
      assert.deepEqual((await run('printInline("a"); printInline("b"); print("c");')).output, ['a', 'b', 'c']);
    });

    it('accepts any Display scalar, same bound as print', async () => {
      assert.deepEqual((await run('printInline(42);')).output, ['42']);
    });

    it('yields Done, like print', async () => {
      assert.deepEqual((await run('printInline("x");')).value, { type: 'Done' });
    });

    it('rejects a value with no text form — a List (T0019)', async () => {
      assert.deepEqual(errorCodes('printInline([1, 2]);'), ['T0019']);
    });

    it('rejects a missing argument (T0014)', async () => {
      assert.deepEqual(errorCodes('printInline();'), ['T0014']);
    });
  });

  describe('prompt', () => {
    it('shows the message inline, then yields the line as-is (no re-ask, any text is valid)', async () => {
      const { output, value } = await run('await prompt!("Name? ");', ['Ada']);
      assert.deepEqual(output, ['Name? ', 'Ada']);
      assert.deepEqual(value, { type: 'String', value: 'Ada' });
    });

    it('passes through an empty line', async () => {
      assert.deepEqual((await run('await prompt!("? ");', [''])).value, { type: 'String', value: '' });
    });

    it('is inert until awaited — preparing it consumes no input', async () => {
      // 't' is prepared but never awaited, so its read never happens; the
      // single scripted line is left for the prompt that actually runs.
      const { value } = await run('fix t = prompt!("first? "); await prompt!("second? ");', ['only line']);
      assert.deepEqual(value, { type: 'String', value: 'only line' });
    });

    it('crashes (R0013) when there is no more input to read', async () => {
      assert.equal(await evalCrash('await prompt!("? ");', []), 'R0013');
    });
  });

  describe('promptInt / promptFloat / promptBool — typed input', () => {
    it('promptInt parses a valid Int', async () => {
      assert.deepEqual((await run('await promptInt!("Age? ");', ['29'])).value, { type: 'Int', value: 29n });
    });

    it('promptInt accepts a negative Int', async () => {
      assert.deepEqual((await run('await promptInt!("? ");', ['-5'])).value, { type: 'Int', value: -5n });
    });

    it('promptInt re-asks on unparseable input, then yields the valid one', async () => {
      const { output, value } = await run('await promptInt!("Age? ");', ['abc', 'xyz', '42']);
      assert.deepEqual(output, ['Age? ', 'Age? ', 'Age? ', '42']);
      assert.deepEqual(value, { type: 'Int', value: 42n });
    });

    it('promptFloat parses a valid Float', async () => {
      assert.deepEqual((await run('await promptFloat!("? ");', ['3.5'])).value, { type: 'Float', value: 3.5 });
    });

    it('promptFloat re-asks on unparseable input', async () => {
      assert.deepEqual((await run('await promptFloat!("? ");', ['nope', '1.5'])).value, { type: 'Float', value: 1.5 });
    });

    it("promptBool accepts exactly 'true' / 'false'", async () => {
      assert.deepEqual((await run('await promptBool!("? ");', ['true'])).value, { type: 'Bool', value: true });
      assert.deepEqual((await run('await promptBool!("? ");', ['false'])).value, { type: 'Bool', value: false });
    });

    it("promptBool re-asks on anything else, including 'True' (case matters)", async () => {
      assert.deepEqual((await run('await promptBool!("? ");', ['True', 'yes', 'true'])).value, { type: 'Bool', value: true });
    });
  });

  describe('the async color is enforced, same as a user async fn', () => {
    it('rejects a bare call — no ! (T0053)', async () => {
      assert.deepEqual(errorCodes('prompt("hi");'), ['T0053']);
      assert.deepEqual(errorCodes('promptInt("hi");'), ['T0053']);
    });

    it('rejects a bare name used as a value (N0017)', async () => {
      assert.deepEqual(errorCodes('fix p = prompt;'), ['N0017']);
    });

    it('rejects a wrong argument type (T0015)', async () => {
      assert.deepEqual(errorCodes('prompt!(42);'), ['T0015']);
    });

    it('rejects a missing argument (T0014)', async () => {
      assert.deepEqual(errorCodes('prompt!();'), ['T0014']);
    });
  });
});
