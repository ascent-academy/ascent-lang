import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { satisfies, iterableElement } from '../src/check/traits.js';
import {
  INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, RANGE_TYPE, listOfType, optionalOf,
} from '../src/types/types.js';

function evalOk(src: string): RuntimeValue {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program, { stdout: () => {} });
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

// The third intrinsic trait (whitepaper §7). Unlike Display / Comparable — plain
// yes/no bounds — Iterable carries an *associated type*, `Item`: the element a
// 'for x in xs' loop binds each pass. So its membership predicate is derived from
// the Item projection (a type is Iterable exactly when it has one).
describe("Iterable trait — the associated type 'Item'", () => {
  describe('iterableElement (the Item projection)', () => {
    it("a List<T>'s Item is its element type T", () => {
      assert.deepEqual(iterableElement(listOfType(INT_TYPE)), INT_TYPE);
      assert.deepEqual(iterableElement(listOfType(STRING_TYPE)), STRING_TYPE);
    });

    it("a nested List<List<Int>>'s Item is List<Int>", () => {
      assert.deepEqual(iterableElement(listOfType(listOfType(INT_TYPE))), listOfType(INT_TYPE));
    });

    it("a Range's Item is Int", () => {
      assert.deepEqual(iterableElement(RANGE_TYPE), INT_TYPE);
    });

    it('a non-iterable type has no Item (null)', () => {
      for (const t of [INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, optionalOf(INT_TYPE)]) {
        assert.equal(iterableElement(t), null);
      }
    });
  });

  describe('satisfies("Iterable", …) is derived from having an Item', () => {
    it('holds for List and Range', () => {
      assert.equal(satisfies('Iterable', listOfType(BOOL_TYPE)), true);
      assert.equal(satisfies('Iterable', RANGE_TYPE), true);
    });

    it('fails for the scalars (and other non-iterables)', () => {
      for (const t of [INT_TYPE, FLOAT_TYPE, BOOL_TYPE, STRING_TYPE, optionalOf(INT_TYPE)]) {
        assert.equal(satisfies('Iterable', t), false);
      }
    });
  });

  // Sanity that the three intrinsic traits stay distinct — a String is Display
  // and Comparable but not Iterable; a List is only Iterable.
  describe('the three intrinsic traits are distinct', () => {
    it('String: Display + Comparable, not Iterable', () => {
      assert.equal(satisfies('Display', STRING_TYPE), true);
      assert.equal(satisfies('Comparable', STRING_TYPE), true);
      assert.equal(satisfies('Iterable', STRING_TYPE), false);
    });

    it('List<Int>: Iterable only', () => {
      const t = listOfType(INT_TYPE);
      assert.equal(satisfies('Display', t), false);
      assert.equal(satisfies('Comparable', t), false);
      assert.equal(satisfies('Iterable', t), true);
    });
  });

  describe("the for loop binds its variable at the iterable's Item type", () => {
    it('a List<List<Int>> element is a List<Int> (its methods are available)', () => {
      // If the loop var weren't typed List<Int>, 'row.length()' wouldn't check.
      assert.deepEqual(
        evalOk('mut n = 0; for row in [[1, 2], [3]] { n = n + row.length() }; n;'),
        { type: 'Int', value: 3n },
      );
    });

    it('a Range element is an Int', () => {
      assert.deepEqual(evalOk('mut s = 0; for i in 1..5 { s = s + i }; s;'), { type: 'Int', value: 10n });
    });

    it('rejects looping over a non-iterable (T0021)', () => {
      assert.ok(errorCodes('for x in 42 { void x };').includes('T0021'));
      assert.ok(errorCodes('for c in "hi" { void c };').includes('T0021'));
    });
  });
});
