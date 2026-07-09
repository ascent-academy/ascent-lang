import assert from 'node:assert/strict';
import { parse, parseTokens } from '../src/parser/index.js';
import { Lexer } from '../src/lexer/index.js';
import { typecheck, TypeEnv } from '../src/check/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its last
// statement's RuntimeValue. Mirrors the harness in the other end-to-end suites.
function evalOk(src: string): RuntimeValue {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program, { stdout: () => {} });
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

function evalCrash(src: string): string {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program, { stdout: () => {} });
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
    it('brings a function into scope and calls it', () => {
      assert.deepEqual(evalOk('import { min } from "math"; min(3, 7);'), int(3n));
    });

    it('brings several functions in at once', () => {
      assert.deepEqual(evalOk('import { min, max } from "math"; max(min(9, 4), 2);'), int(4n));
    });

    it('works inside a function body (captured across a closure)', () => {
      assert.deepEqual(
        evalOk('import { max } from "math"; fix clamp = fn(x: Int, lo: Int): Int => max(x, lo); clamp(2, 5);'),
        int(5n),
      );
    });
  });

  describe('namespace imports — used qualified', () => {
    it('reaches an export through the module name', () => {
      assert.deepEqual(evalOk('import math from "math"; math.min(5, 2);'), int(2n));
    });

    it('a namespace export works inside a closure too', () => {
      assert.deepEqual(
        evalOk('import math from "math"; fix f = fn(a: Int, b: Int): Int => math.max(a, b); f(3, 8);'),
        int(8n),
      );
    });
  });

  describe('math', () => {
    it('min/max promote a mixed Int/Float pair to Float', () => {
      assert.deepEqual(evalOk('import { min } from "math"; min(3, 4.5);'), float(3));
      assert.deepEqual(evalOk('import { max } from "math"; max(3, 4.5);'), float(4.5));
    });

    it('min/max order Strings lexicographically', () => {
      assert.deepEqual(evalOk('import { min } from "math"; min("banana", "apple");'), str('apple'));
    });

    it('sqrt yields a Float, promoting an Int argument', () => {
      assert.deepEqual(evalOk('import { sqrt } from "math"; sqrt(16);'), float(4));
    });

    it('floor / ceil / round yield an Int', () => {
      assert.deepEqual(evalOk('import { floor } from "math"; floor(3.7);'), int(3n));
      assert.deepEqual(evalOk('import { ceil } from "math"; ceil(3.1);'), int(4n));
      assert.deepEqual(evalOk('import { round } from "math"; round(2.5);'), int(3n));
    });

    it('crashes (R0004) on sqrt of a negative — no NaN value exists', () => {
      assert.equal(evalCrash('import { sqrt } from "math"; sqrt(-4);'), 'R0004');
    });
  });

  describe('assert', () => {
    it('assert passes a true condition and yields Done', () => {
      assert.deepEqual(evalOk('import { assert } from "assert"; assert(1 < 2);'), { type: 'Done' });
    });

    it('assert crashes (R0012) on a false condition', () => {
      assert.equal(evalCrash('import { assert } from "assert"; assert(2 < 1);'), 'R0012');
    });

    it('assertEqual passes equal values, including Int vs Float', () => {
      assert.deepEqual(evalOk('import { assertEqual } from "assert"; assertEqual(2 + 2, 4);'), { type: 'Done' });
      assert.deepEqual(evalOk('import { assertEqual } from "assert"; assertEqual(1, 1.0);'), { type: 'Done' });
    });

    it('assertEqual crashes (R0013) on unequal values', () => {
      assert.equal(evalCrash('import { assertEqual } from "assert"; assertEqual(2, 3);'), 'R0013');
    });
  });

  describe('resolution errors', () => {
    it('reports an unknown module (N0014)', () => {
      assert.ok(errorCodes('import { x } from "nope";').includes('N0014'));
    });

    it('reports an unknown export in a named import (N0015)', () => {
      assert.ok(errorCodes('import { bogus } from "math";').includes('N0015'));
    });

    it('reports an unknown export via a namespace (N0015)', () => {
      assert.ok(errorCodes('import math from "math"; math.bogus(1);').includes('N0015'));
    });

    it('reports a namespace used as a value (N0016)', () => {
      assert.deepEqual(errorCodes('import math from "math"; fix x = math;'), ['N0016']);
    });

    it('reports a namespace called on its own (N0016)', () => {
      assert.ok(errorCodes('import math from "math"; math(1);').includes('N0016'));
    });

    it('reports an imported function used as a value (N0013)', () => {
      assert.ok(errorCodes('import { min } from "math"; fix f = min;').includes('N0013'));
    });
  });

  describe('call-checking of stdlib functions', () => {
    it('reports the wrong number of inputs (T0007)', () => {
      assert.ok(errorCodes('import { sqrt } from "math"; sqrt(1, 2);').includes('T0007'));
    });

    it('reports a non-numeric sqrt argument (T0008)', () => {
      assert.ok(errorCodes('import { sqrt } from "math"; sqrt("x");').includes('T0008'));
    });

    it('reports min/max on values that cannot be ordered (T0062)', () => {
      assert.ok(errorCodes('import { min } from "math"; min(True, False);').includes('T0062'));
      assert.ok(errorCodes('import { min } from "math"; min(1, "x");').includes('T0062'));
    });

    it('reports assertEqual on unrelated types (T0063)', () => {
      assert.ok(errorCodes('import { assertEqual } from "assert"; assertEqual(1, "x");').includes('T0063'));
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

    it('a named import stays in scope on a later line', () => {
      const env = new TypeEnv();
      assert.deepEqual(checkLine('import { max } from "math";', env), []);
      assert.deepEqual(checkLine('max(3, 9);', env), []);
    });

    it('a namespace import stays in scope on a later line', () => {
      const env = new TypeEnv();
      assert.deepEqual(checkLine('import math from "math";', env), []);
      assert.deepEqual(checkLine('math.min(3, 9);', env), []);
    });
  });

  describe('import syntax errors', () => {
    it('rejects a missing from (S0042)', () => {
      assert.ok(errorCodes('import { min } "math";').includes('S0042'));
    });

    it('rejects a missing module specifier (S0043)', () => {
      assert.ok(errorCodes('import { min } from math;').includes('S0043'));
    });

    it('rejects neither braces nor a name after import (S0041)', () => {
      assert.ok(errorCodes('import from "math";').includes('S0041'));
    });
  });
});
