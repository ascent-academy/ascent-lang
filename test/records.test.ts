import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { typeToString } from '../src/types/types.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue. Output is streamed to a sink we discard here —
// these tests assert on the structured value executeProgram returns, not its text.
function evalOk(src: string): RuntimeValue {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program, { stdout: () => {} });
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
    it('builds a record and reads its fields', () => {
      assert.deepEqual(
        evalOk(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; p.name;`),
        { type: 'String', value: 'Ada' },
      );
      assert.deepEqual(
        evalOk(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; p.age;`),
        { type: 'Int', value: 30n },
      );
    });

    it('infers the record type on an unannotated slot (no annotation needed)', () => {
      assert.equal(typeOfLast(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; p;`), 'Person');
    });

    it('yields the field types on access', () => {
      assert.equal(typeOfLast(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; p.name;`), 'String');
      assert.equal(typeOfLast(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; p.age;`), 'Int');
    });

    it('binds fields by name, so construction order is irrelevant', () => {
      // age before name, opposite the declaration — still binds each correctly.
      assert.deepEqual(
        evalOk(`${PERSON} fix p = Person{ age: 30, name: "Ada" }; p.name;`),
        { type: 'String', value: 'Ada' },
      );
    });

    it('chains field access through a nested record', () => {
      const src = `
        type Addr = { city: String };
        type Person = { name: String, home: Addr };
        fix p = Person{ name: "Ada", home: Addr{ city: "Prague" } };
        p.home.city;
      `;
      assert.deepEqual(evalOk(src), { type: 'String', value: 'Prague' });
    });

    it('allows a method call on a field value', () => {
      assert.deepEqual(
        evalOk(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; p.name.length();`),
        { type: 'Int', value: 3n },
      );
    });

    it('reads a field inside a string interpolation', () => {
      assert.deepEqual(
        evalOk(`${PERSON} fix p = Person{ name: "Ada", age: 30 }; "Hi \${p.name}, next \${p.age + 1}";`),
        { type: 'String', value: 'Hi Ada, next 31' },
      );
    });
  });

  describe('field coercion & adoption', () => {
    it('widens an Int literal into a Float field', () => {
      assert.deepEqual(
        evalOk('type Money = { amount: Float }; fix m = Money{ amount: 5 }; m.amount;'),
        { type: 'Float', value: 5 },
      );
    });

    it("adopts a bare '[]' into a typed List field", () => {
      assert.deepEqual(
        evalOk('type Bag = { items: List<Int> }; fix b = Bag{ items: [] }; b.items;'),
        { type: 'List', elements: [] },
      );
    });
  });

  describe('records in collections & equality', () => {
    it('infers List<Person> from a list of records', () => {
      assert.equal(
        typeOfLast(`${PERSON} [Person{ name: "A", age: 1 }, Person{ name: "B", age: 2 }];`),
        'List<Person>',
      );
    });

    it('compares records structurally with ==', () => {
      assert.deepEqual(
        evalOk(`${PERSON} Person{ name: "A", age: 1 } == Person{ name: "A", age: 1 };`),
        { type: 'Bool', value: true },
      );
      assert.deepEqual(
        evalOk(`${PERSON} Person{ name: "A", age: 1 } == Person{ name: "A", age: 2 };`),
        { type: 'Bool', value: false },
      );
    });

    it('supports a self-referential field through Optional', () => {
      const src = `
        type Node = { value: Int, next: Node? };
        fix tail = Node{ value: 2, next: None };
        fix head = Node{ value: 1, next: tail };
        head.next;
      `;
      // head.next is a Node? holding the tail record
      assert.deepEqual(evalOk(src), {
        type: 'Record', name: 'Node',
        fields: new Map<string, RuntimeValue>([
          ['value', { type: 'Int', value: 2n }],
          ['next', { type: 'None' }],
        ]),
      });
    });
  });

  describe('name errors', () => {
    it('reports N0005 for an undeclared type in an annotation', () => {
      assert.deepEqual(errorCodes('fix p: Person = 1;'), ['N0005']);
    });

    it('reports N0005 for constructing an undeclared type', () => {
      assert.deepEqual(errorCodes('Person{ name: "A" };'), ['N0005']);
    });

    it('reports N0006 for a duplicate type declaration', () => {
      assert.ok(errorCodes('type P = { x: Int }; type P = { y: Int };').includes('N0006'));
    });

    it('reports N0007 for two fields with the same name', () => {
      assert.deepEqual(errorCodes('type P = { x: Int, x: Float };'), ['N0007']);
    });

    it('reports N0008 for redeclaring a built-in type name', () => {
      assert.deepEqual(errorCodes('type Int = { x: Int };'), ['N0008']);
    });
  });

  describe('type errors', () => {
    it('reports T0018 for a missing field', () => {
      assert.deepEqual(errorCodes(`${PERSON} Person{ name: "A" };`), ['T0018']);
    });

    it('reports T0019 for an unknown field', () => {
      assert.deepEqual(errorCodes(`${PERSON} Person{ name: "A", age: 1, city: "X" };`), ['T0019']);
    });

    it('reports T0020 for the same field given twice', () => {
      assert.deepEqual(errorCodes('type P = { x: Int }; P{ x: 1, x: 2 };'), ['T0020']);
    });

    it('reports T0021 for a field value of the wrong type', () => {
      assert.deepEqual(errorCodes('type P = { x: Int }; P{ x: "no" };'), ['T0021']);
    });

    it('reports T0022 for field access on a non-record', () => {
      assert.deepEqual(errorCodes('fix n = 5; n.foo;'), ['T0022']);
    });

    it('reports T0023 for reading a field the record does not have', () => {
      assert.deepEqual(errorCodes(`${PERSON} fix p = Person{ name: "A", age: 1 }; p.city;`), ['T0023']);
    });

    it('reports T0014 for a whole record in an interpolation hole', () => {
      assert.deepEqual(errorCodes(`${PERSON} fix p = Person{ name: "A", age: 1 }; "\${p}";`), ['T0014']);
    });
  });

  describe('syntax errors', () => {
    it('reports T0018 for a record built bare, without its fields', () => {
      // A bare UpperCamel name is a zero-field construction now (braceless enum
      // case), so 'P' — a record that declares fields — is a missing-field
      // mistake, not the retired S0023 "needs braces".
      assert.ok(errorCodes('type P = { x: Int }; fix p = P;').includes('T0018'));
    });

    it('reports S0010 for a record type in an args declaration', () => {
      assert.ok(errorCodes('args (p: Person); 1;').includes('S0010'));
    });
  });
});
