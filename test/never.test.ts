import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue. Output is streamed to a sink we discard here —
// these tests assert on the structured value executeProgram returns, not its text.
async function evalOk(src: string): Promise<RuntimeValue> {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

describe('Never / List<Never> (end-to-end)', () => {
  describe('an empty list literal with no context', () => {
    it('type-checks on its own (List<Never>), unlike before Never existed', async () => {
      assert.deepEqual(await evalOk('[].isEmpty();'), { type: 'Bool', value: true });
      assert.deepEqual(await evalOk('[].length();'), { type: 'Int', value: 0n });
    });

    it('widens to List<Int> through .append(), since Never widens to any type', async () => {
      assert.deepEqual(await evalOk('[].append(1);'), { type: 'List', elements: [{ type: 'Int', value: 1n }] });
    });

    it('compares equal to another empty list', async () => {
      assert.deepEqual(await evalOk('[] == [];'), { type: 'Bool', value: true });
    });

    it('joins with a concretely-typed list across if/else branches', async () => {
      assert.deepEqual(
        await evalOk('if (True) { [] } else { [1, 2, 3] };'),
        { type: 'List', elements: [] },
      );
      assert.deepEqual(
        await evalOk('if (False) { [] } else { [1, 2, 3] };'),
        { type: 'List', elements: [{ type: 'Int', value: 1n }, { type: 'Int', value: 2n }, { type: 'Int', value: 3n }] },
      );
    });
  });

  describe('an annotated slot', () => {
    it('accepts an empty list literal, taking its type from the annotation', async () => {
      assert.deepEqual(await evalOk('fix xs: List<Int> = []; xs;'), { type: 'List', elements: [] });
    });

    it('lets a mut List<Int> slot grow past an empty starting point', async () => {
      assert.deepEqual(
        await evalOk('mut xs: List<Int> = []; xs = xs.append(1); xs;'),
        { type: 'List', elements: [{ type: 'Int', value: 1n }] },
      );
    });
  });

  describe('an un-annotated slot', () => {
    it('reports T0003 for a bare [] initializer', async () => {
      assert.deepEqual(errorCodes('fix xs = [];'), ['T0003']);
    });

    it('reports T0003 even when the Never is nested (a list of empty lists)', async () => {
      assert.deepEqual(errorCodes('fix xs = [[]];'), ['T0003']);
    });

    it('reports T0003 for a value derived from [] with nothing to widen it', async () => {
      assert.deepEqual(errorCodes('fix xs = [].reverse();'), ['T0003']);
    });

    it('cannot grow: reassigning a widened value back into the frozen List<Never> slot fails', async () => {
      assert.deepEqual(errorCodes('mut xs = []; xs = xs.append(1);'), ['T0003', 'T0001']);
    });
  });

  // A *bare* Never (a diverging initializer) is a different fault from the
  // '[]'/'None' "needs an annotation" family: the value never arrives, so the
  // binding is dead code (T0004), not merely under-typed (T0003).
  describe('a slot bound to a diverging value', () => {
    it("reports T0004 (not the '[]' T0003) for 'fix x = abort …'", async () => {
      assert.deepEqual(errorCodes('fix x = abort "unreachable";'), ['T0004']);
    });

    it('reports T0004 for a diverging return initializer', async () => {
      assert.deepEqual(errorCodes('fix f = fn(): Int { fix x = return 5; x };'), ['T0004']);
    });

    it('reports T0004 when every branch of the initializer diverges', async () => {
      const src = 'fix f = fn(b: Bool): Int { fix x = match b { True -> abort "a", False -> abort "b" }; x };';
      assert.deepEqual(errorCodes(src), ['T0004']);
    });

    it('suppresses the cascade: a later use of the dead slot adds no second error', async () => {
      // Without the Invalid tombstone, 'print(x)' on a Never slot would add T0019.
      assert.deepEqual(errorCodes('fix x = abort "boom"; print(x);'), ['T0004']);
    });

    it('still allows an annotated diverging init as a deliberate stub', async () => {
      assert.deepEqual(errorCodes('fix f = fn(): Int { fix x: Int = abort "todo"; x };'), []);
    });
  });
});
