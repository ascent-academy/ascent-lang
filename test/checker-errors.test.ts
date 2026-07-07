import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';

// The diagnostic codes a program reports, in the order they're raised.
function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

// Core checker rules that other suites exercise only incidentally. Each case is
// the smallest program that reaches exactly one rule, so a regression names it.
describe('checker rules (type & name)', () => {
  describe('type errors', () => {
    it('reports T0002 for a list whose items differ in type', () => {
      assert.deepEqual(errorCodes('[1, "a"];'), ['T0002']);
    });

    it('reports T0008 for a method argument of the wrong type', () => {
      // append onto a List<Int> wants an Int, not a String.
      assert.deepEqual(errorCodes('[1, 2].append("a");'), ['T0008']);
    });

    it('reports T0010 for indexing a value that is not a list', () => {
      assert.deepEqual(errorCodes('fix x = 5; x[0];'), ['T0010']);
    });

    it('reports T0011 for a list index that is not an Int', () => {
      assert.deepEqual(errorCodes('fix xs = [1, 2]; xs["a"];'), ['T0011']);
    });

    it('reports T0012 for a method call on a type that has none', () => {
      // Bool carries no methods, so any '.method()' on it is T0012.
      assert.deepEqual(errorCodes('fix b = True; b.foo();'), ['T0012']);
    });
  });

  describe('name errors', () => {
    it('reports N0003 for assigning to a name that was never created', () => {
      // Distinct from N0001 (using an undefined name in an expression).
      assert.deepEqual(errorCodes('x = 5;'), ['N0003']);
    });
  });
});
