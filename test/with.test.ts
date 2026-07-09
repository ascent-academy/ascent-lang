import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { typeToString } from '../src/types/types.js';

// The 'with' update form (whitepaper §6) — v1 scope: records only, single-field
// updates only (no nested '.field'/'[index]' paths, no list updates yet).

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

// The inferred type of a program's last statement (which must be an expression).
function typeOfLast(src: string): string {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const last = program.stmts[program.stmts.length - 1]!;
  assert.equal(last.kind, 'expr');
  if (last.kind !== 'expr') throw new Error('unreachable');
  return typeToString(last.expr.type);
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

const PERSON = 'type Person = { name: String, age: Int };';
const P = `${PERSON} fix p = Person{ name: "Ada", age: 30 };`;

describe("'with' record update (end-to-end)", () => {
  describe('braceless single-field update', () => {
    it('replaces one field and leaves the rest', () => {
      assert.deepEqual(evalOk(`${P} fix q = p with age = 31; q.age;`), { type: 'Int', value: 31n });
      assert.deepEqual(evalOk(`${P} fix q = p with age = 31; q.name;`), { type: 'String', value: 'Ada' });
    });

    it('leaves the base value untouched (value semantics)', () => {
      // Update p, then read the *original* p — records are immutable, so 'with'
      // returns a fresh copy and never mutates the base.
      assert.deepEqual(evalOk(`${P} fix q = p with age = 31; p.age;`), { type: 'Int', value: 30n });
    });

    it('updates a String field', () => {
      assert.deepEqual(evalOk(`${P} fix q = p with name = "Grace"; q.name;`), { type: 'String', value: 'Grace' });
    });
  });

  describe('braced update', () => {
    it('accepts a single field in braces', () => {
      assert.deepEqual(evalOk(`${P} fix q = p with { age = 31 }; q.age;`), { type: 'Int', value: 31n });
    });

    it('replaces several fields at once', () => {
      const src = `${P} fix q = p with { name = "Grace", age = 41 }; "\${q.name} \${q.age}";`;
      assert.deepEqual(evalOk(src), { type: 'String', value: 'Grace 41' });
    });

    it('binds fields by name, so update order is irrelevant', () => {
      const src = `${P} fix q = p with { age = 41, name = "Grace" }; "\${q.name} \${q.age}";`;
      assert.deepEqual(evalOk(src), { type: 'String', value: 'Grace 41' });
    });
  });

  describe("'its' — the base being updated", () => {
    it('derives a field from its own old value', () => {
      assert.deepEqual(evalOk(`${P} fix q = p with age = its.age + 1; q.age;`), { type: 'Int', value: 31n });
    });

    it('reads a *different* field of the base', () => {
      const src = `
        type Box = { width: Int, height: Int, area: Int };
        fix b = Box{ width: 3, height: 4, area: 0 };
        fix filled = b with area = its.width * its.height;
        filled.area;
      `;
      assert.deepEqual(evalOk(src), { type: 'Int', value: 12n });
    });

    it('is available in every update of a braced form', () => {
      const src = `
        type Order = { total: Float, paid: Bool };
        fix o = Order{ total: 100.0, paid: False };
        fix done = o with { total = its.total * 1.2, paid = True };
        "\${done.total} \${done.paid}";
      `;
      assert.deepEqual(evalOk(src), { type: 'String', value: '120.0 True' });
    });
  });

  describe('typing', () => {
    it("a 'with' update has the base's record type", () => {
      assert.equal(typeOfLast(`${P} p with age = 31;`), 'Person');
    });

    it('widens an Int value into a Float field', () => {
      const src = 'type Money = { amount: Float }; fix m = Money{ amount: 1.5 }; fix n = m with amount = 3; n.amount;';
      assert.deepEqual(evalOk(src), { type: 'Float', value: 3 });
    });

    it('adopts a List field element type from a bare []', () => {
      const src = 'type Bag = { items: List<Int> }; fix b = Bag{ items: [1, 2] }; fix e = b with items = []; e.items.length();';
      assert.deepEqual(evalOk(src), { type: 'Int', value: 0n });
    });
  });

  describe('composing with other forms', () => {
    it('updates a record field with a whole new nested record', () => {
      const src = `
        type Addr = { city: String };
        type Person = { name: String, home: Addr };
        fix p = Person{ name: "Ada", home: Addr{ city: "Prague" } };
        fix moved = p with home = Addr{ city: "Brno" };
        moved.home.city;
      `;
      assert.deepEqual(evalOk(src), { type: 'String', value: 'Brno' });
    });

    it('takes a field-access expression as its base', () => {
      const src = `
        type Addr = { city: String };
        type Person = { name: String, home: Addr };
        fix p = Person{ name: "Ada", home: Addr{ city: "Prague" } };
        fix a = p.home with city = "Brno";
        a.city;
      `;
      assert.deepEqual(evalOk(src), { type: 'String', value: 'Brno' });
    });

    it("works inside a closure, binding 'its' and capturing outer names", () => {
      const src = `
        type Counter = { n: Int };
        fix step = 5;
        fix bump = fn(c: Counter): Counter => c with n = its.n + step;
        fix r = bump(Counter{ n: 10 });
        r.n;
      `;
      assert.deepEqual(evalOk(src), { type: 'Int', value: 15n });
    });

    it('is an ordinary expression usable as a call argument', () => {
      const src = `${P} fix ageOf = fn(x: Person): Int => x.age; ageOf(p with age = 99);`;
      assert.deepEqual(evalOk(src), { type: 'Int', value: 99n });
    });
  });

  describe('list updates (single index, not nested)', () => {
    it('replaces one item and leaves the rest', () => {
      const src = 'fix xs = [10, 20, 30]; fix ys = xs with [1] = 99; "\${ys[0]} \${ys[1]} \${ys[2]}";';
      assert.deepEqual(evalOk(src), { type: 'String', value: '10 99 30' });
    });

    it('leaves the base list untouched (value semantics)', () => {
      const src = 'fix xs = [10, 20, 30]; fix ys = xs with [1] = 99; xs[1];';
      assert.deepEqual(evalOk(src), { type: 'Int', value: 20n });
    });

    it('accepts a computed index expression', () => {
      const src = 'fix xs = [1, 2, 3]; fix i = 2; fix ys = xs with [i] = 9; ys[2];';
      assert.deepEqual(evalOk(src), { type: 'Int', value: 9n });
    });

    it("binds 'its' to the base list (readable + indexable)", () => {
      const src = 'fix xs = [1, 2, 3]; fix ys = xs with [0] = its[2] + 100; ys[0];';
      assert.deepEqual(evalOk(src), { type: 'Int', value: 103n });
    });

    it('updates several indices in braces', () => {
      const src = 'fix xs = [1, 2, 3, 4]; fix ys = xs with { [0] = 5, [3] = 6 }; "\${ys[0]} \${ys[3]}";';
      assert.deepEqual(evalOk(src), { type: 'String', value: '5 6' });
    });

    it('widens an Int value into a Float-list element', () => {
      const src = 'fix xs = [1.0, 2.0]; fix ys = xs with [0] = 7; ys[0];';
      assert.deepEqual(evalOk(src), { type: 'Float', value: 7 });
    });

    it("a list update keeps the list's type", () => {
      assert.equal(typeOfLast('fix xs = [1, 2, 3]; xs with [0] = 9;'), 'List<Int>');
    });

    it('crashes (R0005) on an out-of-range index', () => {
      const { program } = parse('fix xs = [1, 2]; xs with [5] = 0;');
      assert.ok(program !== null);
      const result = executeProgram(program!, { stdout: () => {} });
      assert.equal(result.kind, 'error');
      if (result.kind !== 'error') throw new Error('unreachable');
      assert.equal(result.error.marker.code, 'R0005');
    });

    it('rejects a non-Int index (T0011)', () => {
      assert.deepEqual(errorCodes('fix xs = [1, 2]; xs with ["a"] = 0;'), ['T0011']);
    });

    it('rejects a value of the wrong element type (T0054)', () => {
      assert.deepEqual(errorCodes('fix xs = [1, 2]; xs with [0] = "x";'), ['T0054']);
    });

    it('rejects a field step on a list (T0052)', () => {
      assert.deepEqual(errorCodes('fix xs = [1, 2]; xs with foo = 0;'), ['T0052']);
    });

    it('rejects an index step on a record (T0053)', () => {
      assert.deepEqual(errorCodes(`${P} p with [0] = 2;`), ['T0053']);
    });
  });

  describe('errors', () => {
    it('rejects a non-record, non-list base (T0048)', () => {
      assert.deepEqual(errorCodes('fix x = 5; x with foo = 3;'), ['T0048']);
    });

    it('rejects a multi-variant union base (T0049)', () => {
      const src = 'type Shape = Circle{ r: Int } | Square{ s: Int }; fix c = Circle{ r: 1 }; c with r = 2;';
      assert.deepEqual(errorCodes(src), ['T0049']);
    });

    it("rejects a field the record doesn't have (T0050)", () => {
      assert.deepEqual(errorCodes(`${P} p with nickname = "A";`), ['T0050']);
    });

    it('rejects updating the same field twice (T0051)', () => {
      assert.deepEqual(errorCodes(`${P} p with { age = 31, age = 32 };`), ['T0051']);
    });

    it('rejects a value of the wrong type (T0021)', () => {
      assert.deepEqual(errorCodes(`${P} p with age = "old";`), ['T0021']);
    });

    it('rejects a missing field name after with (S0036)', () => {
      assert.deepEqual(errorCodes(`${P} p with = 3;`), ['S0036']);
    });

    it('rejects a missing = in an update (S0037)', () => {
      assert.deepEqual(errorCodes(`${P} p with age 3;`), ['S0037']);
    });

    it('rejects empty update braces (S0038)', () => {
      assert.deepEqual(errorCodes(`${P} p with { };`), ['S0038']);
    });
  });
});
