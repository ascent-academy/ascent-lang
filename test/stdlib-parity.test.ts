import assert from 'node:assert/strict';
import { MODULE_SIGS, ASYNC_MODULE_SIGS } from '../src/check/stdlib.js';
import { MODULE_IMPLS, ASYNC_MODULE_IMPLS } from '../src/interpreter/stdlib.js';

// The checker's MODULE_SIGS (stdlib signatures) and the interpreter's
// MODULE_IMPLS (stdlib behaviour) are two parallel tables keyed identically —
// module name, then export name — exactly like METHODS ↔ METHOD_IMPLS. This
// pins that they never drift: every signature must have an impl and vice-versa,
// so adding a stdlib function means adding it under the same key in both files,
// and forgetting one is a red test rather than a silent gap (a signature with no
// impl crashes at run time; an impl with no signature is dead code the checker
// never dispatches to).
describe('stdlib tables in sync (checker MODULE_SIGS ↔ runtime MODULE_IMPLS)', () => {
  const modules = [...new Set([...Object.keys(MODULE_SIGS), ...Object.keys(MODULE_IMPLS)])].sort();

  const exportNames = (table: Record<string, Record<string, unknown>>, module: string): string[] =>
    Object.keys(table[module] ?? {}).sort();

  for (const module of modules) {
    it(`${module}: same export names on both sides`, () => {
      assert.deepEqual(
        exportNames(MODULE_IMPLS, module),
        exportNames(MODULE_SIGS, module),
        `"${module}"'s runtime impls and checker signatures list different exports`,
      );
    });
  }
});

// The same pairing for the ASYNC registry (readLines, the 'fs' module) — a
// separate table from MODULE_SIGS/MODULE_IMPLS (see check/stdlib.ts's
// ASYNC_MODULE_SIGS), so it needs its own parity check.
describe('async stdlib tables in sync (checker ASYNC_MODULE_SIGS ↔ runtime ASYNC_MODULE_IMPLS)', () => {
  const modules = [...new Set([...Object.keys(ASYNC_MODULE_SIGS), ...Object.keys(ASYNC_MODULE_IMPLS)])].sort();

  const exportNames = (table: Record<string, Record<string, unknown>>, module: string): string[] =>
    Object.keys(table[module] ?? {}).sort();

  for (const module of modules) {
    it(`${module}: same export names on both sides`, () => {
      assert.deepEqual(
        exportNames(ASYNC_MODULE_IMPLS, module),
        exportNames(ASYNC_MODULE_SIGS, module),
        `"${module}"'s runtime impls and checker signatures list different exports`,
      );
    });
  }
});
