import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost, testCapabilities } from './support/test-host.js';
import { typeToString } from '../src/types/types.js';

// prelude.md's ambient helper types — Pair<A, B>, Entry<K, V>, Ordering — in
// scope with no import, since the stdlib collection types hand them back
// (§4/§7). Pair/Entry are generic, so unlike an ordinary 'type' they're their
// own AscentType kind (src/types/types.ts) with construction/field access
// special-cased (src/check/synth.ts); Ordering isn't generic, so it's a real
// pre-registered Named type (src/check/env.ts) and gets full match/
// exhaustiveness support for free.

async function evalOk(src: string): Promise<RuntimeValue> {
  const { program, diagnostics } = parse(src, testCapabilities);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

function typeOfLast(src: string): string {
  const { program, diagnostics } = parse(src, testCapabilities);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const last = program.stmts[program.stmts.length - 1]!;
  assert.equal(last.kind, 'expr');
  if (last.kind !== 'expr') throw new Error('unreachable');
  return typeToString(last.expr.type);
}

function errorCodes(src: string): string[] {
  return parse(src, testCapabilities).diagnostics.map(d => d.code);
}

describe('ambient helper types (Pair / Entry / Ordering, prelude.md)', () => {
  describe('Pair<A, B>', () => {
    it('constructs and reads first/second', async () => {
      assert.deepEqual(
        await evalOk('fix p = Pair{ first: 1, second: "one" }; p.first;'),
        { type: 'Int', value: 1n },
      );
      assert.deepEqual(
        await evalOk('fix p = Pair{ first: 1, second: "one" }; p.second;'),
        { type: 'String', value: 'one' },
      );
    });

    it('infers its type from the field values', () => {
      assert.equal(typeOfLast('Pair{ first: 1, second: "one" };'), 'Pair<Int, String>');
    });

    it('parses as a type annotation and widens a field (Int -> Float)', async () => {
      assert.deepEqual(
        await evalOk('fix p: Pair<Float, String> = Pair{ first: 1, second: "one" }; p.first;'),
        { type: 'Float', value: 1 },
      );
    });

    it('compares structurally with ==', async () => {
      assert.deepEqual(
        await evalOk('Pair{ first: 1, second: 2 } == Pair{ first: 1, second: 2 };'),
        { type: 'Bool', value: true },
      );
      assert.deepEqual(
        await evalOk('Pair{ first: 1, second: 2 } == Pair{ first: 1, second: 3 };'),
        { type: 'Bool', value: false },
      );
    });

    it('rejects a missing field (T0022)', () => {
      assert.deepEqual(errorCodes('Pair{ first: 1 };'), ['T0022']);
    });

    it('rejects an unknown field (T0023)', () => {
      assert.deepEqual(errorCodes('Pair{ first: 1, second: 2, third: 3 };'), ['T0023']);
    });

    it('rejects a duplicate field (T0024)', () => {
      assert.deepEqual(errorCodes('Pair{ first: 1, first: 2, second: 3 };'), ['T0024']);
    });

    it('rejects reading a field it does not have (T0027)', () => {
      assert.deepEqual(errorCodes('Pair{ first: 1, second: 2 }.third;'), ['T0027']);
    });

    it('rejects an unannotated slot built from a bare [] component (T0003)', () => {
      assert.deepEqual(errorCodes('fix p = Pair{ first: [], second: 1 };'), ['T0003']);
    });

    it('rejects a comparison against a Pair with a function component (T0064)', () => {
      assert.deepEqual(
        errorCodes('fix f = fn(x: Int): Int => x; Pair{ first: f, second: 1 } == Pair{ first: f, second: 1 };'),
        ['T0064'],
      );
    });

    it("rejects a missing comma between Pair's type arguments (S0045)", () => {
      assert.deepEqual(errorCodes('fix p: Pair<Int String> = Pair{ first: 1, second: 2 };'), ['S0045']);
    });

    it('is a non-shadowable name (N0008 on redeclaration)', () => {
      assert.deepEqual(errorCodes('type Pair = { x: Int };'), ['N0008']);
    });
  });

  describe('Entry<K, V>', () => {
    it('constructs and reads key/value', async () => {
      assert.deepEqual(
        await evalOk('fix e = Entry{ key: "score", value: 42 }; e.key;'),
        { type: 'String', value: 'score' },
      );
      assert.deepEqual(
        await evalOk('fix e = Entry{ key: "score", value: 42 }; e.value;'),
        { type: 'Int', value: 42n },
      );
    });

    it('infers its type from the field values', () => {
      assert.equal(typeOfLast('Entry{ key: "score", value: 42 };'), 'Entry<String, Int>');
    });

    it('is a distinct type from Pair even with the same component types', () => {
      assert.deepEqual(errorCodes('Entry{ key: 1, value: 2 } == Pair{ first: 1, second: 2 };'), ['T0008']);
    });

    it('is a non-shadowable name (N0008 on redeclaration)', () => {
      assert.deepEqual(errorCodes('type Entry = { x: Int };'), ['N0008']);
    });
  });

  describe('Ordering', () => {
    it('constructs each bare variant (a braceless enum)', () => {
      assert.equal(typeOfLast('Less;'), 'Ordering');
      assert.equal(typeOfLast('Equal;'), 'Ordering');
      assert.equal(typeOfLast('Greater;'), 'Ordering');
    });

    it('matches exhaustively', async () => {
      const src = [
        'fix describe = fn(o: Ordering): String => match o {',
        '  Less -> "less",',
        '  Equal -> "equal",',
        '  Greater -> "greater",',
        '};',
        'describe(Greater);',
      ].join('\n');
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'greater' });
    });

    it('rejects a non-exhaustive match (T0031)', () => {
      assert.deepEqual(
        errorCodes('fix o = Less; match o { Less -> 1, Equal -> 2 };'),
        ['T0031'],
      );
    });

    it('compares structurally with ==', async () => {
      assert.deepEqual(await evalOk('Less == Less;'), { type: 'Bool', value: true });
      assert.deepEqual(await evalOk('Less == Greater;'), { type: 'Bool', value: false });
    });

    it('is a non-shadowable name (N0008 on redeclaration)', () => {
      assert.deepEqual(errorCodes('type Ordering = { x: Int };'), ['N0008']);
    });

    it("rejects reusing one of its tags in a user type (N0010)", () => {
      assert.deepEqual(errorCodes('type Bad = Less | Other{ x: Int };'), ['N0010']);
    });
  });
});
