import assert from 'node:assert/strict';
import { METHODS } from '../src/check/signatures.js';
import { METHOD_IMPLS } from '../src/interpreter/builtins.js';

// The checker's METHODS (type signatures) and the interpreter's METHOD_IMPLS
// (runtime behaviour) are two parallel tables keyed identically — receiver
// type kind, then method name (see the "builtins two-table" decision behind
// Phase 5 of agenda/interpreter-refactor.md). This pins that they never drift:
// every typed signature must have a runtime impl and vice-versa, so adding a
// builtin means adding an entry under the same key in both files, and
// forgetting one is a red test rather than a silent gap (a checker signature
// with no impl crashes at run time; an impl with no signature is dead code the
// checker will never dispatch to).
describe('builtin tables in sync (checker METHODS ↔ runtime METHOD_IMPLS)', () => {
  const methodNames = (table: Partial<Record<string, Record<string, unknown>>>, type: string): string[] =>
    Object.keys(table[type] ?? {}).sort();

  const types = [...new Set([...Object.keys(METHODS), ...Object.keys(METHOD_IMPLS)])].sort();

  for (const type of types) {
    it(`${type}: same method names on both sides`, () => {
      assert.deepEqual(
        methodNames(METHOD_IMPLS, type),
        methodNames(METHODS, type),
        `${type}'s runtime impls and checker signatures list different methods`,
      );
    });
  }
});
