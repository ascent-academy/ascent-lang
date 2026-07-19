import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost, testCapabilities } from './support/test-host.js';
import { typeToString } from '../src/types/types.js';

// The 'with' update form (whitepaper §6) — v1 scope: records only, single-field
// updates only (no nested '.field'/'[index]' paths, no list updates yet).

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue.
async function evalOk(src: string): Promise<RuntimeValue> {
  const { program, diagnostics } = parse(src, testCapabilities);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

// The inferred type of a program's last statement (which must be an expression).
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

const PERSON = 'type Person = { name: String, age: Int };';
const P = `${PERSON} fix p = Person{ name: "Ada", age: 30 };`;

describe("'with' record update (end-to-end)", () => {
  describe('braceless single-field update', () => {
    it('replaces one field and leaves the rest', async () => {
      assert.deepEqual(await evalOk(`${P} fix q = p with age = 31; q.age;`), { type: 'Int', value: 31n });
      assert.deepEqual(await evalOk(`${P} fix q = p with age = 31; q.name;`), { type: 'String', value: 'Ada' });
    });

    it('leaves the base value untouched (value semantics)', async () => {
      // Update p, then read the *original* p — records are immutable, so 'with'
      // returns a fresh copy and never mutates the base.
      assert.deepEqual(await evalOk(`${P} fix q = p with age = 31; p.age;`), { type: 'Int', value: 30n });
    });

    it('updates a String field', async () => {
      assert.deepEqual(await evalOk(`${P} fix q = p with name = "Grace"; q.name;`), { type: 'String', value: 'Grace' });
    });
  });

  describe('braced update', () => {
    it('accepts a single field in braces', async () => {
      assert.deepEqual(await evalOk(`${P} fix q = p with { age = 31 }; q.age;`), { type: 'Int', value: 31n });
    });

    it('replaces several fields at once', async () => {
      const src = `${P} fix q = p with { name = "Grace", age = 41 }; "\${q.name} \${q.age}";`;
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'Grace 41' });
    });

    it('binds fields by name, so update order is irrelevant', async () => {
      const src = `${P} fix q = p with { age = 41, name = "Grace" }; "\${q.name} \${q.age}";`;
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'Grace 41' });
    });
  });

  describe("'its' — the base being updated", () => {
    it('derives a field from its own old value', async () => {
      assert.deepEqual(await evalOk(`${P} fix q = p with age = its.age + 1; q.age;`), { type: 'Int', value: 31n });
    });

    it('reads a *different* field of the base', async () => {
      const src = `
        type Box = { width: Int, height: Int, area: Int };
        fix b = Box{ width: 3, height: 4, area: 0 };
        fix filled = b with area = its.width * its.height;
        filled.area;
      `;
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 12n });
    });

    it('is available in every update of a braced form', async () => {
      const src = `
        type Order = { total: Float, paid: Bool };
        fix o = Order{ total: 100.0, paid: False };
        fix done = o with { total = its.total * 1.2, paid = True };
        "\${done.total} \${done.paid}";
      `;
      assert.deepEqual(await evalOk(src), { type: 'String', value: '120.0 True' });
    });
  });

  describe('typing', () => {
    it("a 'with' update has the base's record type", async () => {
      assert.equal(typeOfLast(`${P} p with age = 31;`), 'Person');
    });

    it('widens an Int value into a Float field', async () => {
      const src = 'type Money = { amount: Float }; fix m = Money{ amount: 1.5 }; fix n = m with amount = 3; n.amount;';
      assert.deepEqual(await evalOk(src), { type: 'Float', value: 3 });
    });

    it('adopts a List field element type from a bare []', async () => {
      const src = 'type Bag = { items: List<Int> }; fix b = Bag{ items: [1, 2] }; fix e = b with items = []; e.items.length();';
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 0n });
    });
  });

  describe('composing with other forms', () => {
    it('updates a record field with a whole new nested record', async () => {
      const src = `
        type Addr = { city: String };
        type Person = { name: String, home: Addr };
        fix p = Person{ name: "Ada", home: Addr{ city: "Prague" } };
        fix moved = p with home = Addr{ city: "Brno" };
        moved.home.city;
      `;
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'Brno' });
    });

    it('takes a field-access expression as its base', async () => {
      const src = `
        type Addr = { city: String };
        type Person = { name: String, home: Addr };
        fix p = Person{ name: "Ada", home: Addr{ city: "Prague" } };
        fix a = p.home with city = "Brno";
        a.city;
      `;
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'Brno' });
    });

    it("works inside a closure, binding 'its' and capturing outer names", async () => {
      const src = `
        type Counter = { n: Int };
        fix step = 5;
        fix bump = fn(c: Counter): Counter => c with n = its.n + step;
        fix r = bump(Counter{ n: 10 });
        r.n;
      `;
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 15n });
    });

    it('is an ordinary expression usable as a call argument', async () => {
      const src = `${P} fix ageOf = fn(x: Person): Int => x.age; ageOf(p with age = 99);`;
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 99n });
    });
  });

  describe('list updates (single index, not nested)', () => {
    it('replaces one item and leaves the rest', async () => {
      const src = 'fix xs = [10, 20, 30]; fix ys = xs with [1] = 99; "\${ys[0]} \${ys[1]} \${ys[2]}";';
      assert.deepEqual(await evalOk(src), { type: 'String', value: '10 99 30' });
    });

    it('leaves the base list untouched (value semantics)', async () => {
      const src = 'fix xs = [10, 20, 30]; fix ys = xs with [1] = 99; xs[1];';
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 20n });
    });

    it('accepts a computed index expression', async () => {
      const src = 'fix xs = [1, 2, 3]; fix i = 2; fix ys = xs with [i] = 9; ys[2];';
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 9n });
    });

    it("binds 'its' to the base list (readable + indexable)", async () => {
      const src = 'fix xs = [1, 2, 3]; fix ys = xs with [0] = its[2] + 100; ys[0];';
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 103n });
    });

    it('updates several indices in braces', async () => {
      const src = 'fix xs = [1, 2, 3, 4]; fix ys = xs with { [0] = 5, [3] = 6 }; "\${ys[0]} \${ys[3]}";';
      assert.deepEqual(await evalOk(src), { type: 'String', value: '5 6' });
    });

    it('widens an Int value into a Float-list element', async () => {
      const src = 'fix xs = [1.0, 2.0]; fix ys = xs with [0] = 7; ys[0];';
      assert.deepEqual(await evalOk(src), { type: 'Float', value: 7 });
    });

    it("a list update keeps the list's type", async () => {
      assert.equal(typeOfLast('fix xs = [1, 2, 3]; xs with [0] = 9;'), 'List<Int>');
    });

    it('crashes (R0005) on an out-of-range index', async () => {
      const { program } = parse('fix xs = [1, 2]; xs with [5] = 0;', testCapabilities);
      assert.ok(program !== null);
      const result = await executeProgram(program!, testHost());
      assert.equal(result.kind, 'error');
      if (result.kind !== 'error') throw new Error('unreachable');
      assert.equal(result.error.marker.code, 'R0005');
    });

    it('rejects a non-Int index (T0007)', async () => {
      assert.deepEqual(errorCodes('fix xs = [1, 2]; xs with ["a"] = 0;'), ['T0007']);
    });

    it('rejects a value of the wrong element type (T0040)', async () => {
      assert.deepEqual(errorCodes('fix xs = [1, 2]; xs with [0] = "x";'), ['T0040']);
    });

    it('rejects a field step on a list, pointing to [index] (T0038)', async () => {
      assert.deepEqual(errorCodes('fix xs = [1, 2]; xs with foo = 0;'), ['T0038']);
    });

    it('rejects an index step on a record, pointing to a field name (T0039)', async () => {
      assert.deepEqual(errorCodes(`${P} p with [0] = 2;`), ['T0039']);
    });
  });

  describe('nested paths (the update path is the read path)', () => {
    const ADDR = 'type Addr = { city: String };';
    const USER = 'type User = { name: String, home: Addr };';
    const MODEL = 'type Model = { users: List<User> };';
    const M = `${ADDR} ${USER} ${MODEL} fix m = Model{ users: [User{ name: "Ada", home: Addr{ city: "London" } }, User{ name: "Bo", home: Addr{ city: "Rome" } }] };`;

    it('updates a deep field/index/field path', async () => {
      assert.deepEqual(
        await evalOk(`${M} fix m2 = m with users[1].home.city = "Prague"; m2.users[1].home.city;`),
        { type: 'String', value: 'Prague' },
      );
    });

    it('shares the rest of the structure (only the path is copied)', async () => {
      // The sibling and the original are untouched — value semantics all the way down.
      assert.deepEqual(
        await evalOk(`${M} fix m2 = m with users[1].home.city = "Prague"; m2.users[0].home.city;`),
        { type: 'String', value: 'London' },
      );
      assert.deepEqual(
        await evalOk(`${M} fix m2 = m with users[1].home.city = "Prague"; m.users[1].home.city;`),
        { type: 'String', value: 'Rome' },
      );
    });

    it('updates a 2-D list position (grid[i][j])', async () => {
      const src = 'fix grid = [[1, 2], [3, 4]]; fix g = grid with [1][0] = 99; "\${g[1][0]} \${g[1][1]} \${g[0][0]}";';
      assert.deepEqual(await evalOk(src), { type: 'String', value: '99 4 1' });
    });

    it('mixes deep field and index paths in braces', async () => {
      const src = `
        type P = { name: String, tags: List<String> };
        fix p = P{ name: "x", tags: ["a", "b"] };
        fix q = p with { name = "y", tags[0] = its.name };
        "\${q.name} \${q.tags[0]} \${q.tags[1]}";
      `;
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'y x b' });
    });

    it('crashes (R0005) on an out-of-range index anywhere along the path', async () => {
      const { program } = parse(`${M} m with users[9].home.city = "x";`, testCapabilities);
      assert.ok(program !== null);
      const result = await executeProgram(program!, testHost());
      assert.equal(result.kind, 'error');
      if (result.kind !== 'error') throw new Error('unreachable');
      assert.equal(result.error.marker.code, 'R0005');
    });

    it('reports a clear update error mid-path: index into a scalar (T0035)', async () => {
      assert.deepEqual(errorCodes(`${P} p with age[0] = 2;`), ['T0035']);
    });

    it('reports a clear update error mid-path: field on a scalar (T0035)', async () => {
      assert.deepEqual(errorCodes(`${P} p with age.x = 2;`), ['T0035']);
    });

    it('reports a clear update error mid-path: unknown field (T0037)', async () => {
      assert.deepEqual(errorCodes(`${M} m with users[0].nope = "x";`), ['T0037']);
    });

    it('reports a clear update error mid-path: non-Int index (T0007)', async () => {
      assert.deepEqual(errorCodes(`${M} m with users["a"].name = "x";`), ['T0007']);
    });

    it('mid-path field on a list points to [index] (T0038)', async () => {
      // 'users.name' forgot the '[i]' — a common beginner slip the error catches.
      assert.deepEqual(errorCodes(`${M} m with users.name = "x";`), ['T0038']);
    });

    it('flags a duplicated deep path (T0041)', async () => {
      assert.deepEqual(errorCodes(`${M} m with { users[0].name = "x", users[0].name = "y" };`), ['T0041']);
    });

    it('does not flag a duplicate with a computed index (undecidable)', async () => {
      const src = 'fix i = 0; fix xs = [1, 2]; xs with { [i] = 5, [i] = 9 };';
      assert.deepEqual(errorCodes(src), []);
    });
  });

  describe('errors', () => {
    it('rejects updating inside a non-record, non-list value (T0035)', async () => {
      assert.deepEqual(errorCodes('fix x = 5; x with foo = 3;'), ['T0035']);
    });

    it('rejects a multi-variant union, pointing to match (T0036)', async () => {
      const src = 'type Shape = Circle{ r: Int } | Square{ s: Int }; fix c = Circle{ r: 1 }; c with r = 2;';
      assert.deepEqual(errorCodes(src), ['T0036']);
    });

    it("rejects a field the record doesn't have (T0037)", async () => {
      assert.deepEqual(errorCodes(`${P} p with nickname = "A";`), ['T0037']);
    });

    it('rejects updating the same position twice (T0041)', async () => {
      assert.deepEqual(errorCodes(`${P} p with { age = 31, age = 32 };`), ['T0041']);
    });

    it('rejects a value of the wrong type (T0025)', async () => {
      assert.deepEqual(errorCodes(`${P} p with age = "old";`), ['T0025']);
    });

    it('rejects a missing field name after with (S0031)', async () => {
      assert.deepEqual(errorCodes(`${P} p with = 3;`), ['S0031']);
    });

    it('rejects a missing = in an update (S0032)', async () => {
      assert.deepEqual(errorCodes(`${P} p with age 3;`), ['S0032']);
    });

    it('rejects empty update braces (S0033)', async () => {
      assert.deepEqual(errorCodes(`${P} p with { };`), ['S0033']);
    });
  });
});
