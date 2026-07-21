import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost, testCapabilities } from './support/test-host.js';

// Structural '==' / '!=' across the compound types (design.md §5/§7). Regression
// suite: list equality used to be silently broken — valuesEqual had no List case,
// so any two same-typed lists fell through to "equal", making '[1,2] == [1,3]'
// True and '[1] != [2]' False (and corrupting records/Results that carry lists).
// Only '[] == []' was ever tested, which passed even with the bug.
async function evalBool(src: string): Promise<boolean> {
  const { program, diagnostics } = parse(src, testCapabilities);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null);
  const result = await executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  const v: RuntimeValue = result.value;
  assert.equal(v.type, 'Bool', `expected a Bool, got ${v.type}`);
  if (v.type !== 'Bool') throw new Error('unreachable');
  return v.value;
}

function errorCodes(src: string): string[] {
  return parse(src, testCapabilities).diagnostics.map(d => d.code);
}

describe('structural equality (==) on compound values', () => {
  describe('lists', () => {
    it('equal lists are equal, differing lists are not', async () => {
      assert.equal(await evalBool('[1, 2, 3] == [1, 2, 3];'), true);
      assert.equal(await evalBool('[1, 2, 3] == [1, 9, 3];'), false);
    });

    it('differ by length', async () => {
      assert.equal(await evalBool('[1, 2] == [1, 2, 3];'), false);
      assert.equal(await evalBool('[1, 2, 3] == [1, 2];'), false);
    });

    it("'!=' is the negation", async () => {
      assert.equal(await evalBool('[1] != [2];'), true);
      assert.equal(await evalBool('[1, 2] != [1, 2];'), false);
    });

    it('two empty lists are equal; empty vs non-empty is not', async () => {
      assert.equal(await evalBool('[] == [];'), true);
      assert.equal(await evalBool('fix a: List<Int> = []; a == [1];'), false);
    });

    it('compares Int against Float element-wise (the one-way promotion)', async () => {
      assert.equal(await evalBool('[1, 2] == [1.0, 2.0];'), true);
      assert.equal(await evalBool('[1, 2] == [1.0, 2.5];'), false);
    });

    it('recurses into nested lists', async () => {
      assert.equal(await evalBool('[[1, 2], [3]] == [[1, 2], [3]];'), true);
      assert.equal(await evalBool('[[1, 2], [3]] == [[1, 2], [4]];'), false);
    });
  });

  describe('lists carried inside other values', () => {
    it('a record with a list field compares deep', async () => {
      assert.equal(await evalBool('type P = { xs: List<Int> }; P{ xs: [1, 2] } == P{ xs: [1, 2] };'), true);
      assert.equal(await evalBool('type P = { xs: List<Int> }; P{ xs: [1, 2] } == P{ xs: [1, 9] };'), false);
    });

    it('a list of records compares deep', async () => {
      assert.equal(await evalBool('type P = { x: Int }; [P{ x: 1 }, P{ x: 2 }] == [P{ x: 1 }, P{ x: 2 }];'), true);
      assert.equal(await evalBool('type P = { x: Int }; [P{ x: 1 }] == [P{ x: 2 }];'), false);
    });
  });

  describe('records, ranges, Result, Optional (for completeness)', () => {
    it('records compare field-by-field', async () => {
      assert.equal(await evalBool('type P = { x: Int, y: Int }; P{ x: 1, y: 2 } == P{ x: 1, y: 2 };'), true);
      assert.equal(await evalBool('type P = { x: Int, y: Int }; P{ x: 1, y: 2 } == P{ x: 1, y: 9 };'), false);
    });

    it('ranges compare by bounds', async () => {
      assert.equal(await evalBool('1..3 == 1..3;'), true);
      assert.equal(await evalBool('1..3 == 1..4;'), false);
    });

    it('Results compare by variant and payload', async () => {
      assert.equal(await evalBool('fix a: Int orfail String = Success{ value: 1 }; fix b: Int orfail String = Success{ value: 1 }; a == b;'), true);
      assert.equal(await evalBool('fix a: Int orfail String = Success{ value: 1 }; fix b: Int orfail String = Success{ value: 2 }; a == b;'), false);
      assert.equal(await evalBool('fix a: Int orfail String = Success{ value: 1 }; fix b: Int orfail String = Failure{ error: "x" }; a == b;'), false);
    });

    it('Optionals compare present values and None', async () => {
      assert.equal(await evalBool('fix a: Int? = 5; fix b: Int? = 5; a == b;'), true);
      assert.equal(await evalBool('fix a: Int? = 5; a == None;'), false);
      assert.equal(await evalBool('fix a: Int? = None; a == None;'), true);
    });
  });

  // A function has no equality (whitepaper §5) — and that carve-out has to
  // reach a function wherever it's hiding, not just a bare 'f == g', or two
  // records/lists that merely happen to carry the same function would slip
  // past the checker and silently compare "not equal" at runtime instead of
  // being rejected (T0064).
  describe('functions have no equality, even nested (T0064)', () => {
    it('rejects a function buried in a record field', () => {
      assert.deepEqual(
        errorCodes('type H = { run: Fn(Int) -> Int }; fix f = fn(x: Int): Int => x; fix a = H{ run: f }; fix b = H{ run: f }; a == b;'),
        ['T0064'],
      );
    });

    it('rejects a function buried in a list element', () => {
      assert.deepEqual(
        errorCodes('fix f = fn(x: Int): Int => x; [f] == [f];'),
        ['T0064'],
      );
    });
  });
});
