import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';
import { typeToString } from '../src/types/types.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue.
async function evalOk(src: string): Promise<RuntimeValue> {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost());
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

// Irrefutable patterns in a 'fix'/'mut' binding — one-line destructuring of a
// single-variant record's fields into named locals (whitepaper §5, the honest
// replacement for tuples). Fields bind by name, a subset is fine, and a
// refutable pattern (a union case that might not match) is rejected.
describe('destructuring bindings', () => {
  describe('evaluation', () => {
    it('binds each field to a local of the same name (punning)', async () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ name, age } = p; age;`;
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 30n });
    });

    it('binds the punned name straight through', async () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ name, age } = p; name;`;
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'Bob' });
    });

    it("renames a field with 'field: local'", async () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ name: who } = p; who;`;
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'Bob' });
    });

    it('binds a subset — unnamed fields are ignored', async () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ name } = p; name;`;
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'Bob' });
    });

    it('is order-independent (fields bind by name, never position)', async () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ age, name } = p; name;`;
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'Bob' });
    });

    it('coerces a field value the same way construction does (Int field stays Int, Float field widens)', async () => {
      const src = 'type Point = { x: Float, y: Float }; fix pt = Point{ x: 1, y: 2 }; fix Point{ x } = pt; x;';
      assert.deepEqual(await evalOk(src), { type: 'Float', value: 1 });
    });

    it('works with the explicit single-variant spelling', async () => {
      const src = 'type Div = Div{ q: Int, r: Int }; fix Div{ q, r } = Div{ q: 7, r: 1 }; q + r;';
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 8n });
    });

    it("'mut' makes each destructured local reassignable", async () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; mut Person{ age } = p; age = 31; age;`;
      assert.deepEqual(await evalOk(src), { type: 'Int', value: 31n });
    });
  });

  describe('inference', () => {
    it('gives each local the field’s declared type', async () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ age } = p; age;`;
      assert.equal(typeOfLast(src), 'Int');
    });

    it('a renamed local carries the field type', async () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ name: who } = p; who;`;
      assert.equal(typeOfLast(src), 'String');
    });
  });

  describe('errors', () => {
    it('a fix-destructured local is immutable (N0002 on reassign)', async () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ age } = p; age = 31;`;
      assert.deepEqual(errorCodes(src), ['N0002']);
    });

    it('T0034 — a union variant is refutable, so it can’t be destructured in a binding', async () => {
      const src = 'type Shape = Circle{ radius: Float } | Square{ side: Float };'
        + ' fix s: Shape = Circle{ radius: 2.0 }; fix Circle{ radius } = s;';
      assert.deepEqual(errorCodes(src), ['T0034']);
    });

    it('T0034 — the union type name itself is refutable too', async () => {
      const src = 'type Shape = Circle{ radius: Float } | Square{ side: Float };'
        + ' fix s: Shape = Circle{ radius: 2.0 }; fix Shape{ radius } = s;';
      assert.deepEqual(errorCodes(src), ['T0034']);
    });

    it('T0023 — a field the record doesn’t declare', async () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ height } = p;`;
      assert.deepEqual(errorCodes(src), ['T0023']);
    });

    it('T0024 — the same field named twice', async () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ name, name } = p;`;
      assert.deepEqual(errorCodes(src), ['T0024']);
    });

    it('T0001 — the value isn’t of the pattern’s record type', async () => {
      const src = `${PERSON} type Car = { wheels: Int }; fix c = Car{ wheels: 4 }; fix Person{ name } = c;`;
      assert.deepEqual(errorCodes(src), ['T0001']);
    });

    it('T0001 — a scalar can’t be destructured as a record', async () => {
      const src = `${PERSON} fix Person{ name } = 5;`;
      assert.deepEqual(errorCodes(src), ['T0001']);
    });

    it('N0005 — an unknown type name in the pattern', async () => {
      const src = 'fix Foo{ x } = 1;';
      assert.deepEqual(errorCodes(src), ['N0005']);
    });

    it('N0012 — a built-in type name in the pattern', async () => {
      const src = 'fix Int{ x } = 1;';
      assert.deepEqual(errorCodes(src), ['N0012']);
    });

    it('S0023 — empty pattern braces bind nothing', async () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ } = p;`;
      assert.deepEqual(errorCodes(src), ['S0023']);
    });
  });
});
