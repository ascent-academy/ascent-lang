import assert from 'node:assert/strict';
import { parse, parseTokens } from '../src/parser/index.js';
import { Lexer } from '../src/lexer/index.js';
import { typecheck, TypeEnv } from '../src/check/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its last
// statement's RuntimeValue. Mirrors the harness in the other end-to-end suites.
async function evalOk(src: string): Promise<RuntimeValue> {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

async function evalCrash(src: string): Promise<string> {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost());
  assert.equal(result.kind, 'error');
  if (result.kind !== 'error') throw new Error('unreachable');
  return result.error.marker.code;
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

const int = (v: bigint): RuntimeValue => ({ type: 'Int', value: v });
const float = (v: number): RuntimeValue => ({ type: 'Float', value: v });
const str = (v: string): RuntimeValue => ({ type: 'String', value: v });

describe('stdlib module system (end-to-end)', () => {
  describe('named imports — used bare', () => {
    it('brings a function into scope and calls it', async () => {
      assert.deepEqual(await evalOk('import { min } from "math"; min(3, 7);'), int(3n));
    });

    it('brings several functions in at once', async () => {
      assert.deepEqual(await evalOk('import { min, max } from "math"; max(min(9, 4), 2);'), int(4n));
    });

    it('works inside a function body (captured across a closure)', async () => {
      assert.deepEqual(
        await evalOk('import { max } from "math"; fix clamp = fn(x: Int, lo: Int): Int => max(x, lo); clamp(2, 5);'),
        int(5n),
      );
    });
  });

  describe('namespace imports — used qualified', () => {
    it('reaches an export through the module name', async () => {
      assert.deepEqual(await evalOk('import math from "math"; math.min(5, 2);'), int(2n));
    });

    it('a namespace export works inside a closure too', async () => {
      assert.deepEqual(
        await evalOk('import math from "math"; fix f = fn(a: Int, b: Int): Int => math.max(a, b); f(3, 8);'),
        int(8n),
      );
    });
  });

  describe('math', () => {
    it('min/max promote a mixed Int/Float pair to Float', async () => {
      assert.deepEqual(await evalOk('import { min } from "math"; min(3, 4.5);'), float(3));
      assert.deepEqual(await evalOk('import { max } from "math"; max(3, 4.5);'), float(4.5));
    });

    it('min/max order Strings lexicographically', async () => {
      assert.deepEqual(await evalOk('import { min } from "math"; min("banana", "apple");'), str('apple'));
    });

    it('sqrt yields a Float, promoting an Int argument', async () => {
      assert.deepEqual(await evalOk('import { sqrt } from "math"; sqrt(16);'), float(4));
    });

    it('floor / ceil / round yield an Int', async () => {
      assert.deepEqual(await evalOk('import { floor } from "math"; floor(3.7);'), int(3n));
      assert.deepEqual(await evalOk('import { ceil } from "math"; ceil(3.1);'), int(4n));
      assert.deepEqual(await evalOk('import { round } from "math"; round(2.5);'), int(3n));
    });

    it('crashes (R0004) on sqrt of a negative — no NaN value exists', async () => {
      assert.equal(await evalCrash('import { sqrt } from "math"; sqrt(-4);'), 'R0004');
    });
  });

  describe('assert', () => {
    it('assert passes a true condition and yields Done', async () => {
      assert.deepEqual(await evalOk('import { assert } from "assert"; assert(1 < 2);'), { type: 'Done' });
    });

    it('assert crashes (R0011) on a false condition', async () => {
      assert.equal(await evalCrash('import { assert } from "assert"; assert(2 < 1);'), 'R0011');
    });

    it('assertEqual passes equal values, including Int vs Float', async () => {
      assert.deepEqual(await evalOk('import { assertEqual } from "assert"; assertEqual(2 + 2, 4);'), { type: 'Done' });
      assert.deepEqual(await evalOk('import { assertEqual } from "assert"; assertEqual(1, 1.0);'), { type: 'Done' });
    });

    it('assertEqual crashes (R0012) on unequal values', async () => {
      assert.equal(await evalCrash('import { assertEqual } from "assert"; assertEqual(2, 3);'), 'R0012');
    });
  });

  describe('resolution errors', () => {
    it('reports an unknown module (N0014)', async () => {
      assert.ok(errorCodes('import { x } from "nope";').includes('N0014'));
    });

    it('reports an unknown export in a named import (N0015)', async () => {
      assert.ok(errorCodes('import { bogus } from "math";').includes('N0015'));
    });

    it('reports an unknown export via a namespace (N0015)', async () => {
      assert.ok(errorCodes('import math from "math"; math.bogus(1);').includes('N0015'));
    });

    it('reports a namespace used as a value (N0016)', async () => {
      assert.deepEqual(errorCodes('import math from "math"; fix x = math;'), ['N0016']);
    });

    it('reports a namespace called on its own (N0016)', async () => {
      assert.ok(errorCodes('import math from "math"; math(1);').includes('N0016'));
    });

    it('reports an imported function used as a value (N0013)', async () => {
      assert.ok(errorCodes('import { min } from "math"; fix f = min;').includes('N0013'));
    });
  });

  describe('call-checking of stdlib functions', () => {
    it('reports the wrong number of inputs (T0014)', async () => {
      assert.ok(errorCodes('import { sqrt } from "math"; sqrt(1, 2);').includes('T0014'));
    });

    it('reports a non-numeric sqrt argument (T0015)', async () => {
      assert.ok(errorCodes('import { sqrt } from "math"; sqrt("x");').includes('T0015'));
    });

    it('reports min/max on values that cannot be ordered (T0061)', async () => {
      assert.ok(errorCodes('import { min } from "math"; min(True, False);').includes('T0061'));
      assert.ok(errorCodes('import { min } from "math"; min(1, "x");').includes('T0061'));
    });

    it('reports assertEqual on unrelated types (T0062)', async () => {
      assert.ok(errorCodes('import { assertEqual } from "assert"; assertEqual(1, "x");').includes('T0062'));
    });
  });

  describe('REPL persistence (imports carry across lines)', () => {
    // Each REPL line type-checks into a child of one shared parent env, promoting
    // its new bindings on success — so an 'import' on one line must keep its names
    // in scope on the next (the promotion in check/index.ts). Drives that path
    // directly, since piped multi-line REPL input isn't exercised by the CLI.
    const checkLine = (src: string, env: TypeEnv): string[] => {
      const { program } = parseTokens(new Lexer(src).tokenize().tokens);
      return typecheck(program!, src, env).diagnostics.map(d => d.code);
    };

    it('a named import stays in scope on a later line', async () => {
      const env = new TypeEnv();
      assert.deepEqual(checkLine('import { max } from "math";', env), []);
      assert.deepEqual(checkLine('max(3, 9);', env), []);
    });

    it('a namespace import stays in scope on a later line', async () => {
      const env = new TypeEnv();
      assert.deepEqual(checkLine('import math from "math";', env), []);
      assert.deepEqual(checkLine('math.min(3, 9);', env), []);
    });
  });

  describe('placement — imports lead the file, never inside a body', () => {
    it('rejects an import inside a function body (S0042)', async () => {
      assert.ok(errorCodes('fix f = fn(): Int { import { max } from "math"; max(2, 9) };').includes('S0042'));
    });

    it('rejects an import inside a program body (S0042)', async () => {
      assert.ok(errorCodes('program (x: Int) { import { min } from "math"; min(x, 5) }').includes('S0042'));
    });

    it("rejects an import inside an 'if' body (S0042)", async () => {
      assert.ok(errorCodes('if (True) { import { min } from "math"; min(1, 2) } else { 0 };').includes('S0042'));
    });

    it('rejects an import that comes after another top-level statement (S0043)', async () => {
      assert.ok(errorCodes('fix a = 1; import { min } from "math"; min(a, 2);').includes('S0043'));
    });

    it('rejects a top-level import placed after a type declaration (S0043)', async () => {
      assert.ok(errorCodes('type P = { n: Int }; import { min } from "math"; min(1, 2);').includes('S0043'));
    });

    it('accepts leading imports whose names are used in a later fn / program body', async () => {
      const src = 'import { min, max } from "math";'
        + ' fix clamp = fn(x: Int): Int => min(max(x, 0), 100);'
        + ' clamp(250);';
      assert.deepEqual(await evalOk(src), int(100n));
    });

    it('accepts several contiguous leading imports', async () => {
      assert.deepEqual(errorCodes('import { min } from "math"; import assert from "assert"; min(1, 2);'), []);
    });
  });

  describe('import syntax errors', () => {
    it('rejects a missing from (S0040)', async () => {
      assert.ok(errorCodes('import { min } "math";').includes('S0040'));
    });

    it('rejects a missing module specifier (S0041)', async () => {
      assert.ok(errorCodes('import { min } from math;').includes('S0041'));
    });

    it('rejects neither braces nor a name after import (S0039)', async () => {
      assert.ok(errorCodes('import from "math";').includes('S0039'));
    });
  });
});
