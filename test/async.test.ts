import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';

// Same harness as the other end-to-end suites (see functions.test.ts): run a
// clean program and return both the emitted text and the structured final
// value; or collect the error codes of a program that shouldn't typecheck.
function run(src: string): { output: string[]; value: RuntimeValue } {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const output: string[] = [];
  const result = executeProgram(program, { stdout: text => output.push(text) });
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return { output, value: result.value };
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

const int = (value: bigint): RuntimeValue => ({ type: 'Int', value });

describe('async / await (end-to-end)', () => {
  describe('preparing and awaiting a task', () => {
    it('awaits an async call inline, yielding its result (§8)', () => {
      assert.deepEqual(run('fix fetch = async fn(x: Int): Int { x * 2 }; await fetch!(5);').value, int(10n));
    });

    it('prepares a task, then awaits it in two steps', () => {
      assert.deepEqual(
        run('fix fetch = async fn(x: Int): Int { x * 2 }; fix t = fetch!(5); await t;').value,
        int(10n),
      );
    });

    it('a prepared task is inert — its body does not run until awaited', () => {
      // Only awaiting runs the body, so the "running" line appears *after* the
      // "prepared" line, never before (the whitepaper's honest core, §8).
      const { output } = run(
        'fix fetch = async fn(x: Int): Done { print("ran") }; fix t = fetch!(5); print("prepared"); await t;',
      );
      assert.deepEqual(output, ['prepared', 'ran']);
    });

    it('binds the arguments at preparation time', () => {
      // The argument expression is evaluated when the task is prepared, so the
      // "arg" line prints before "prepared" — the body ("ran") only on await.
      const { output } = run([
        'fix log = fn(x: Int): Int { print("arg"); x };',
        'fix fetch = async fn(x: Int): Done { print("ran") };',
        'fix t = fetch!(log(1));',
        'print("prepared");',
        'await t;',
      ].join('\n'));
      assert.deepEqual(output, ['arg', 'prepared', 'ran']);
    });

    it('widens an Int argument into a Float parameter through the task (§5)', () => {
      assert.deepEqual(
        run('fix f = async fn(x: Float): Float { x + 1.0 }; await f!(3);').value,
        { type: 'Float', value: 4 },
      );
    });

    it('awaits a task held in a Task<T>-annotated slot', () => {
      assert.deepEqual(
        run('fix f = async fn(x: Int): Int { x }; fix t: Task<Int> = f!(5); await t;').value,
        int(5n),
      );
    });

    it('renders a prepared task as its Task type when it is the final value', () => {
      assert.deepEqual(run('fix f = async fn(x: Int): Int { x }; f!(5);').output, ['Task<Int>']);
    });
  });

  describe('async bodies await other tasks (the color propagates)', () => {
    it('an async fn awaits another async call in its body', () => {
      assert.deepEqual(
        run([
          'fix inner = async fn(x: Int): Int { x + 1 };',
          'fix outer = async fn(x: Int): Int { fix v = await inner!(x); v * 10 };',
          'await outer!(4);',
        ].join('\n')).value,
        int(50n),
      );
    });

    it('a recursive async fn awaits itself (recursive-let, §5)', () => {
      assert.deepEqual(
        run([
          'fix sum = async fn(n: Int): Int { if (n == 0) { 0 } else { fix r = await sum!(n - 1); r + n } };',
          'await sum!(3);',
        ].join('\n')).value,
        int(6n),
      );
    });

    it('awaits a Result-returning async call, then matches it (§9)', () => {
      assert.deepEqual(
        run([
          'fix read = async fn(ok: Bool): Int orfail String {',
          '  if (ok) { Success{ value: 42 } } else { Failure{ error: "bad" } }',
          '};',
          'fix use = async fn(): Int { fix r = await read!(True); match r { Success{ value } -> value, Failure{ error } -> 0 } };',
          'await use!();',
        ].join('\n')).value,
        int(42n),
      );
    });

    it("'try await' waits, then propagates the failure (§8/§9)", () => {
      // try await: await resolves the timing, then try unwraps-or-propagates the
      // settled Result. Driven to its Failure, the whole task returns it.
      const { value } = run([
        'fix read = async fn(ok: Bool): Int orfail String {',
        '  if (ok) { Success{ value: 42 } } else { Failure{ error: "bad" } }',
        '};',
        'fix use = async fn(ok: Bool): Int orfail String { fix n = try await read!(ok); Success{ value: n + 1 } };',
        'await use!(False);',
      ].join('\n'));
      assert.equal(value.type, 'Record');
      if (value.type !== 'Record') throw new Error('unreachable');
      assert.equal(value.name, 'Failure');
      assert.deepEqual(value.fields.get('error'), { type: 'String', value: 'bad' });
    });
  });

  describe('the async color is enforced', () => {
    it('rejects a bare async call — no !  (T0053)', () => {
      assert.deepEqual(errorCodes('fix f = async fn(x: Int): Int { x }; f(5);'), ['T0053']);
    });

    it("rejects '!' on an ordinary (non-async) function (T0054)", () => {
      assert.deepEqual(errorCodes('fix f = fn(x: Int): Int { x }; f!(5);'), ['T0054']);
    });

    it("rejects '!' on a value that isn't a function (T0054)", () => {
      assert.deepEqual(errorCodes('fix x = 5; x!();'), ['T0054']);
    });

    it("rejects 'await' on a value that isn't a task (T0055)", () => {
      assert.deepEqual(errorCodes('await 5;'), ['T0055']);
    });

    it("rejects 'await' inside a plain, non-async function (T0056)", () => {
      assert.deepEqual(
        errorCodes('fix g = async fn(x: Int): Int { x }; fix f = fn(x: Int): Int { await g!(x) };'),
        ['T0056'],
      );
    });

    it("rejects 'await try' — there is no Result until await produces one (T0050)", () => {
      // 'try' is applied to the task, but a task is neither an Optional nor a
      // Result, so there's nothing to unwrap: the valid order is 'try await'.
      // Checked inside a Result-returning async fn so 'try' itself is in a valid
      // spot (no try-outside-function error) — the only fault is its operand.
      assert.deepEqual(
        errorCodes('fix f = async fn(): Int { 1 }; fix g = async fn(): Int orfail String { await try f!() };'),
        ['T0050'],
      );
    });

    it('rejects comparing two tasks with == (T0008)', () => {
      assert.deepEqual(errorCodes('fix f = async fn(): Int { 1 }; f!() == f!();'), ['T0008']);
    });
  });

  describe('async / await surface syntax', () => {
    it("rejects '!' without an argument list (S0038)", () => {
      assert.deepEqual(errorCodes('fix f = async fn(): Int { 1 }; f!;'), ['S0038']);
    });

    it("rejects 'async' not followed by 'fn' (S0037)", () => {
      assert.deepEqual(errorCodes('fix x = async 5;'), ['S0037']);
    });

    it("'(await t).method()' needs parentheses — await binds looser than a call", () => {
      // Without parens, '.last()' would attach to the task (which has no methods);
      // parenthesizing awaits first, then calls on the resulting String.
      assert.deepEqual(
        run('fix f = async fn(): String { "abc" }; (await f!()).last();').value,
        { type: 'String', value: 'c' },
      );
    });
  });
});
