import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue.
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

const POINT = 'type Point = { x: Int, y: Int };';
const POINTS = `${POINT} fix points = [Point{ x: 1, y: 2 }, Point{ x: 3, y: 4 }];`;

// Destructuring in a 'for' loop (whitepaper §5) — the loop variable is a
// BindTarget, so 'for Point{ x, y } in points' pulls each element's fields apart
// per iteration. Same irrefutability rule as a fix/mut binding.
describe('for-loop destructuring', () => {
  describe('evaluation', () => {
    it('destructures each element into its fields', () => {
      const src = `${POINTS} mut total = 0; for Point{ x, y } in points { total = total + x + y }; total;`;
      assert.deepEqual(evalOk(src), { type: 'Int', value: 10n });
    });

    it('renames bound fields', () => {
      const src = `${POINTS} mut total = 0; for Point{ x: a, y: b } in points { total = total + a * b }; total;`;
      assert.deepEqual(evalOk(src), { type: 'Int', value: 14n }); // 1*2 + 3*4
    });

    it('binds a subset — unnamed fields are ignored', () => {
      const src = `${POINTS} mut total = 0; for Point{ x } in points { total = total + x }; total;`;
      assert.deepEqual(evalOk(src), { type: 'Int', value: 4n }); // 1 + 3
    });

    it('runs zero times over an empty list without binding', () => {
      const src = `${POINT} fix ps: List<Point> = []; mut total = 0; for Point{ x } in ps { total = total + x }; total;`;
      assert.deepEqual(evalOk(src), { type: 'Int', value: 0n });
    });
  });

  describe('errors', () => {
    it('a loop-destructured local is immutable in the body (N0002)', () => {
      const src = `${POINTS} for Point{ x } in points { x = 5 };`;
      assert.deepEqual(errorCodes(src), ['N0002']);
    });

    it('T0034 — a union variant is refutable, so it can’t destructure the loop', () => {
      const src = 'type Shape = Circle{ radius: Float } | Square{ side: Float };'
        + ' fix shapes = [Circle{ radius: 1.0 }]; for Circle{ radius } in shapes { void radius };';
      assert.deepEqual(errorCodes(src), ['T0034']);
    });

    it('T0001 — the element type isn’t the pattern’s record type', () => {
      const src = `${POINTS} type Vec = { a: Int }; for Vec{ a } in points { void a };`;
      assert.deepEqual(errorCodes(src), ['T0001']);
    });

    it('T0001 — a Range’s Ints can’t be destructured as a record', () => {
      const src = `${POINT} for Point{ x } in 0..3 { void x };`;
      assert.deepEqual(errorCodes(src), ['T0001']);
    });

    it('T0023 — a field the record doesn’t declare', () => {
      const src = `${POINTS} for Point{ z } in points { void z };`;
      assert.deepEqual(errorCodes(src), ['T0023']);
    });

    it('N0005 — an unknown type name in the pattern', () => {
      const src = `${POINTS} for Foo{ x } in points { void x };`;
      assert.deepEqual(errorCodes(src), ['N0005']);
    });

    it('S0015 — the target is neither a name nor a pattern', () => {
      assert.ok(errorCodes(`${POINTS} for 5 in points { void 1 };`).includes('S0015'));
    });

    it('S0023 — empty pattern braces bind nothing', () => {
      const src = `${POINTS} for Point{} in points { void 1 };`;
      assert.deepEqual(errorCodes(src), ['S0023']);
    });
  });
});
