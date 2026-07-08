import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';

// Same harness as the other end-to-end suites: run a clean program and return
// both the emitted text and the structured final value; or collect the error
// codes of a program that shouldn't typecheck.
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

describe('functions (end-to-end)', () => {
  describe('definition and calls', () => {
    it('defines a function and calls it', () => {
      assert.deepEqual(run('fix double = fn(x: Int) -> Int { x * 2 }; double(5);').value, int(10n));
    });

    it('calls a zero-parameter function (a thunk)', () => {
      assert.deepEqual(run('fix answer = fn() -> Int { 42 }; answer();').value, int(42n));
    });

    it('takes several parameters, bound positionally', () => {
      assert.deepEqual(run('fix add = fn(a: Int, b: Int) -> Int { a + b }; add(3, 4);').value, int(7n));
    });

    it('the body is a block whose last statement is the return value (§2)', () => {
      assert.deepEqual(run('fix f = fn(x: Int) -> Int { fix y = x + 1; y * 2 }; f(3);').value, int(8n));
    });

    it('widens an Int argument into a Float parameter (the one-way rule, §5)', () => {
      assert.deepEqual(run('fix f = fn(x: Float) -> Float { x + 1.0 }; f(3);').value, { type: 'Float', value: 4 });
    });

    it('returns Done and may print for effect in its body', () => {
      const { output, value } = run('fix greet = fn(name: String) -> Done { print("hi ${name}") }; greet("Ada");');
      assert.deepEqual(output, ['hi Ada']);
      assert.deepEqual(value, { type: 'Done' });
    });

    it('is a first-class value — callable by name inside a loop', () => {
      assert.deepEqual(run('fix inc = fn(x: Int) -> Int { x + 1 }; mut sum = 0; for x in [1, 2, 3] { sum = sum + inc(x) }; sum;').value, int(9n));
    });

    it('renders a function as its type when it is the final value', () => {
      assert.deepEqual(run('fix f = fn(x: Int) -> Int { x }; f;').output, ['fn(Int) -> Int']);
    });
  });

  describe('recursion (recursive fix, §5)', () => {
    it('computes factorial by self-reference', () => {
      assert.deepEqual(run('fix fact = fn(n: Int) -> Int { if (n <= 1) { 1 } else { n * fact(n - 1) } }; fact(5);').value, int(120n));
    });

    it('computes fibonacci (two self-calls)', () => {
      assert.deepEqual(run('fix fib = fn(n: Int) -> Int { if (n < 2) { n } else { fib(n - 1) + fib(n - 2) } }; fib(10);').value, int(55n));
    });

    it('resolves the self-reference even with an explicit function-type annotation', () => {
      assert.deepEqual(run('fix f: fn(Int) -> Int = fn(n: Int) -> Int { if (n <= 0) { 0 } else { f(n - 1) } }; f(3);').value, int(0n));
    });
  });

  describe('closures capture by value (§5)', () => {
    it('captures an outer fixed slot', () => {
      assert.deepEqual(run('fix base = 10; fix add = fn(x: Int) -> Int { x + base }; add(5);').value, int(15n));
    });

    // The defining guarantee: a closure snapshots the value at creation, so a
    // later change to the outer slot is invisible to it — the same mechanism
    // that makes the loop-footgun impossible.
    it('snapshots the value — a later change to the outer slot does not affect it', () => {
      assert.deepEqual(run('mut base = 1; fix f = fn() -> Int { base }; base = 2; f();').value, int(1n));
    });

    it('a returned closure captures its maker\'s parameter by value', () => {
      assert.deepEqual(run('fix make = fn(n: Int) -> fn() -> Int { fn() -> Int { n } }; fix g = make(7); fix h = make(9); g() + h();').value, int(16n));
    });
  });

  describe('higher-order functions', () => {
    it('takes a function parameter and calls it', () => {
      assert.deepEqual(run('fix apply = fn(g: fn(Int) -> Int, x: Int) -> Int { g(x) }; fix inc = fn(x: Int) -> Int { x + 1 }; apply(inc, 4);').value, int(5n));
    });

    it('returns a function that is then applied', () => {
      assert.deepEqual(run('fix adder = fn(n: Int) -> fn(Int) -> Int { fn(x: Int) -> Int { x + n } }; fix add3 = adder(3); add3(10);').value, int(13n));
    });
  });

  describe('function types', () => {
    it('accepts a function value against a matching function-type annotation', () => {
      assert.deepEqual(run('fix f: fn(Int) -> Int = fn(x: Int) -> Int { x * 2 }; f(4);').value, int(8n));
    });

    // Arrow types are invariant (§7 — no variance): fn(Int) -> Int is not a
    // fn(Int) -> Float, even though Int widens to Float.
    it('is invariant — fn(Int) -> Int does not fit a fn(Int) -> Float slot (T0001)', () => {
      assert.deepEqual(errorCodes('fix f: fn(Int) -> Float = fn(x: Int) -> Int { x };'), ['T0001']);
    });

    it('rejects a function argument of the wrong type (T0008)', () => {
      assert.deepEqual(
        errorCodes('fix apply = fn(g: fn(Int) -> Int, x: Int) -> Int { g(x) }; fix bad = fn(x: Float) -> Float { x }; apply(bad, 1);'),
        ['T0008'],
      );
    });
  });

  describe('errors', () => {
    it('rejects calling a name that is not a function (T0035)', () => {
      assert.deepEqual(errorCodes('fix x = 5; x(3);'), ['T0035']);
    });

    it('rejects calling an unknown name (T0013)', () => {
      assert.deepEqual(errorCodes('nope(3);'), ['T0013']);
    });

    it('rejects a wrong argument count (T0007)', () => {
      assert.deepEqual(errorCodes('fix f = fn(x: Int) -> Int { x }; f(1, 2);'), ['T0007']);
      assert.deepEqual(errorCodes('fix f = fn(x: Int) -> Int { x }; f();'), ['T0007']);
    });

    it('rejects an argument of the wrong type (T0008)', () => {
      assert.deepEqual(errorCodes('fix f = fn(x: Int) -> Int { x }; f("s");'), ['T0008']);
    });

    it('rejects a body whose value does not match the return type (T0036)', () => {
      assert.deepEqual(errorCodes('fix f = fn(x: Int) -> Int { "no" };'), ['T0036']);
    });

    it('rejects comparing functions with == (T0009)', () => {
      assert.deepEqual(errorCodes('fix f = fn(x: Int) -> Int { x }; f == f;'), ['T0009']);
    });

    it('rejects a signature with no return type (S0031)', () => {
      assert.deepEqual(errorCodes('fix f = fn(x: Int) { x };'), ['S0031']);
    });

    it('still reports an undefined name used in a function body (N0001)', () => {
      assert.deepEqual(errorCodes('fix f = fn(x: Int) -> Int { x + missing };'), ['N0001']);
    });
  });
});
