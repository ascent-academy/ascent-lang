import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';

// Structural '==' / '!=' across the compound types (design.md §5/§7). Regression
// suite: list equality used to be silently broken — valuesEqual had no List case,
// so any two same-typed lists fell through to "equal", making '[1,2] == [1,3]'
// True and '[1] != [2]' False (and corrupting records/Results that carry lists).
// Only '[] == []' was ever tested, which passed even with the bug.
function evalBool(src: string): boolean {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null);
  const result = executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  const v: RuntimeValue = result.value;
  assert.equal(v.type, 'Bool', `expected a Bool, got ${v.type}`);
  if (v.type !== 'Bool') throw new Error('unreachable');
  return v.value;
}

describe('structural equality (==) on compound values', () => {
  describe('lists', () => {
    it('equal lists are equal, differing lists are not', () => {
      assert.equal(evalBool('[1, 2, 3] == [1, 2, 3];'), true);
      assert.equal(evalBool('[1, 2, 3] == [1, 9, 3];'), false);
    });

    it('differ by length', () => {
      assert.equal(evalBool('[1, 2] == [1, 2, 3];'), false);
      assert.equal(evalBool('[1, 2, 3] == [1, 2];'), false);
    });

    it("'!=' is the negation", () => {
      assert.equal(evalBool('[1] != [2];'), true);
      assert.equal(evalBool('[1, 2] != [1, 2];'), false);
    });

    it('two empty lists are equal; empty vs non-empty is not', () => {
      assert.equal(evalBool('[] == [];'), true);
      assert.equal(evalBool('fix a: List<Int> = []; a == [1];'), false);
    });

    it('compares Int against Float element-wise (the one-way promotion)', () => {
      assert.equal(evalBool('[1, 2] == [1.0, 2.0];'), true);
      assert.equal(evalBool('[1, 2] == [1.0, 2.5];'), false);
    });

    it('recurses into nested lists', () => {
      assert.equal(evalBool('[[1, 2], [3]] == [[1, 2], [3]];'), true);
      assert.equal(evalBool('[[1, 2], [3]] == [[1, 2], [4]];'), false);
    });
  });

  describe('lists carried inside other values', () => {
    it('a record with a list field compares deep', () => {
      assert.equal(evalBool('type P = { xs: List<Int> }; P{ xs: [1, 2] } == P{ xs: [1, 2] };'), true);
      assert.equal(evalBool('type P = { xs: List<Int> }; P{ xs: [1, 2] } == P{ xs: [1, 9] };'), false);
    });

    it('a list of records compares deep', () => {
      assert.equal(evalBool('type P = { x: Int }; [P{ x: 1 }, P{ x: 2 }] == [P{ x: 1 }, P{ x: 2 }];'), true);
      assert.equal(evalBool('type P = { x: Int }; [P{ x: 1 }] == [P{ x: 2 }];'), false);
    });
  });

  describe('records, ranges, Result, Optional (for completeness)', () => {
    it('records compare field-by-field', () => {
      assert.equal(evalBool('type P = { x: Int, y: Int }; P{ x: 1, y: 2 } == P{ x: 1, y: 2 };'), true);
      assert.equal(evalBool('type P = { x: Int, y: Int }; P{ x: 1, y: 2 } == P{ x: 1, y: 9 };'), false);
    });

    it('ranges compare by bounds', () => {
      assert.equal(evalBool('1..3 == 1..3;'), true);
      assert.equal(evalBool('1..3 == 1..4;'), false);
    });

    it('Results compare by variant and payload', () => {
      assert.equal(evalBool('fix a: Int orfail String = Success{ value: 1 }; fix b: Int orfail String = Success{ value: 1 }; a == b;'), true);
      assert.equal(evalBool('fix a: Int orfail String = Success{ value: 1 }; fix b: Int orfail String = Success{ value: 2 }; a == b;'), false);
      assert.equal(evalBool('fix a: Int orfail String = Success{ value: 1 }; fix b: Int orfail String = Failure{ error: "x" }; a == b;'), false);
    });

    it('Optionals compare present values and None', () => {
      assert.equal(evalBool('fix a: Int? = 5; fix b: Int? = 5; a == b;'), true);
      assert.equal(evalBool('fix a: Int? = 5; a == None;'), false);
      assert.equal(evalBool('fix a: Int? = None; a == None;'), true);
    });
  });
});
