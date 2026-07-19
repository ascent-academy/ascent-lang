import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';
import { typeToString } from '../src/types/types.js';

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

// The inferred type of a program's last statement (which must be an
// expression), rendered as it would appear in a diagnostic.
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

describe('Records (end-to-end)', () => {
  describe('construction & field access', () => {
    it('builds a record and reads its fields', async () => {
      assert.deepEqual(
        await evalOk(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; p.name;`),
        { type: 'String', value: 'Ada' },
      );
      assert.deepEqual(
        await evalOk(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; p.age;`),
        { type: 'Int', value: 30n },
      );
    });

    it('infers the record type on an unannotated slot (no annotation needed)', async () => {
      assert.equal(typeOfLast(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; p;`), 'Person');
    });

    it('yields the field types on access', async () => {
      assert.equal(typeOfLast(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; p.name;`), 'String');
      assert.equal(typeOfLast(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; p.age;`), 'Int');
    });

    it('binds fields by name, so construction order is irrelevant', async () => {
      // age before name, opposite the declaration — still binds each correctly.
      assert.deepEqual(
        await evalOk(`${PERSON} fix p = Person{ age: 30, name: "Ada" }; p.name;`),
        { type: 'String', value: 'Ada' },
      );
    });

    it('chains field access through a nested record', async () => {
      const src = `
        type Addr = { city: String };
        type Person = { name: String, home: Addr };
        fix p = Person{ name: "Ada", home: Addr{ city: "Prague" } };
        p.home.city;
      `;
      assert.deepEqual(await evalOk(src), { type: 'String', value: 'Prague' });
    });

    it('allows a method call on a field value', async () => {
      assert.deepEqual(
        await evalOk(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; p.name.length();`),
        { type: 'Int', value: 3n },
      );
    });

    it('reads a field inside a string interpolation', async () => {
      assert.deepEqual(
        await evalOk(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; "Hi \${p.name}, next \${p.age + 1}";`),
        { type: 'String', value: 'Hi Ada, next 31' },
      );
    });
  });

  describe('field coercion & adoption', () => {
    it('widens an Int literal into a Float field', async () => {
      assert.deepEqual(
        await evalOk('type Money = { amount: Float }; fix m = Money{ amount: 5 }; m.amount;'),
        { type: 'Float', value: 5 },
      );
    });

    it("adopts a bare '[]' into a typed List field", async () => {
      assert.deepEqual(
        await evalOk('type Bag = { items: List<Int> }; fix b = Bag{ items: [] }; b.items;'),
        { type: 'List', elements: [] },
      );
    });
  });

  describe('records in collections & equality', () => {
    it('infers List<Person> from a list of records', async () => {
      assert.equal(
        typeOfLast(`${PERSON} [Person{ name: "A", age: 1 }, Person{ name: "B", age: 2 }];`),
        'List<Person>',
      );
    });

    it('compares records structurally with ==', async () => {
      assert.deepEqual(
        await evalOk(`${PERSON} Person{ name: "A", age: 1 } == Person{ name: "A", age: 1 };`),
        { type: 'Bool', value: true },
      );
      assert.deepEqual(
        await evalOk(`${PERSON} Person{ name: "A", age: 1 } == Person{ name: "A", age: 2 };`),
        { type: 'Bool', value: false },
      );
    });

    it('supports a self-referential field through Optional', async () => {
      const src = `
        type Node = { value: Int, next: Node? };
        fix tail = Node{ value: 2, next: None };
        fix head = Node{ value: 1, next: tail };
        head.next;
      `;
      // head.next is a Node? holding the tail record
      assert.deepEqual(await evalOk(src), {
        type: 'Record', name: 'Node',
        fields: new Map<string, RuntimeValue>([
          ['value', { type: 'Int', value: 2n }],
          ['next', { type: 'None' }],
        ]),
      });
    });
  });

  describe('name errors', () => {
    it('reports N0005 for an undeclared type in an annotation', async () => {
      assert.deepEqual(errorCodes('fix p: Person = 1;'), ['N0005']);
    });

    it('reports N0005 for constructing an undeclared type', async () => {
      assert.deepEqual(errorCodes('Person{ name: "A" };'), ['N0005']);
    });

    it('reports N0006 for a duplicate type declaration', async () => {
      assert.ok(errorCodes('type P = { x: Int }; type P = { y: Int };').includes('N0006'));
    });

    it('reports N0007 for two fields with the same name', async () => {
      assert.deepEqual(errorCodes('type P = { x: Int, x: Float };'), ['N0007']);
    });

    it('reports N0008 for redeclaring a built-in type name', async () => {
      assert.deepEqual(errorCodes('type Int = { x: Int };'), ['N0008']);
    });
  });

  describe('type errors', () => {
    it('reports T0022 for a missing field', async () => {
      assert.deepEqual(errorCodes(`${PERSON} Person{ name: "A" };`), ['T0022']);
    });

    it('reports T0023 for an unknown field', async () => {
      assert.deepEqual(errorCodes(`${PERSON} Person{ name: "A", age: 1, city: "X" };`), ['T0023']);
    });

    it('reports T0024 for the same field given twice', async () => {
      assert.deepEqual(errorCodes('type P = { x: Int }; P{ x: 1, x: 2 };'), ['T0024']);
    });

    it('reports T0025 for a field value of the wrong type', async () => {
      assert.deepEqual(errorCodes('type P = { x: Int }; P{ x: "no" };'), ['T0025']);
    });

    it('reports T0026 for field access on a non-record', async () => {
      assert.deepEqual(errorCodes('fix n = 5; n.foo;'), ['T0026']);
    });

    it('reports T0027 for reading a field the record does not have', async () => {
      assert.deepEqual(errorCodes(`${PERSON} fix p = Person{ name: "A", age: 1 }; p.city;`), ['T0027']);
    });

    it('reports T0018 for a whole record in an interpolation hole', async () => {
      assert.deepEqual(errorCodes(`${PERSON} fix p = Person{ name: "A", age: 1 }; "\${p}";`), ['T0018']);
    });
  });

  describe('syntax errors', () => {
    it('reports T0022 for a record built bare, without its fields', async () => {
      // A bare UpperCamel name is a zero-field construction now (braceless enum
      // case), so 'P' — a record that declares fields — is a missing-field
      // mistake, not a "needs braces" error.
      assert.ok(errorCodes('type P = { x: Int }; fix p = P;').includes('T0022'));
    });

    it('reports S0012 for a record type in a program input list', async () => {
      assert.ok(errorCodes('program (p: Person) { 1 }').includes('S0012'));
    });
  });
});
