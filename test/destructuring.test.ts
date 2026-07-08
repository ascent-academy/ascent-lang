import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { typeToString } from '../src/types/types.js';

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

// Irrefutable patterns in a 'fix'/'mut' binding — one-line destructuring of a
// single-variant record's fields into named locals (whitepaper §5, the honest
// replacement for tuples). Fields bind by name, a subset is fine, and a
// refutable pattern (a union case that might not match) is rejected.
describe('destructuring bindings', () => {
  describe('evaluation', () => {
    it('binds each field to a local of the same name (punning)', () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ name, age } = p; age;`;
      assert.deepEqual(evalOk(src), { type: 'Int', value: 30n });
    });

    it('binds the punned name straight through', () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ name, age } = p; name;`;
      assert.deepEqual(evalOk(src), { type: 'String', value: 'Bob' });
    });

    it("renames a field with 'field: local'", () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ name: who } = p; who;`;
      assert.deepEqual(evalOk(src), { type: 'String', value: 'Bob' });
    });

    it('binds a subset — unnamed fields are ignored', () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ name } = p; name;`;
      assert.deepEqual(evalOk(src), { type: 'String', value: 'Bob' });
    });

    it('is order-independent (fields bind by name, never position)', () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ age, name } = p; name;`;
      assert.deepEqual(evalOk(src), { type: 'String', value: 'Bob' });
    });

    it('coerces a field value the same way construction does (Int field stays Int, Float field widens)', () => {
      const src = 'type Point = { x: Float, y: Float }; fix pt = Point{ x: 1, y: 2 }; fix Point{ x } = pt; x;';
      assert.deepEqual(evalOk(src), { type: 'Float', value: 1 });
    });

    it('works with the explicit single-variant spelling', () => {
      const src = 'type Div = Div{ q: Int, r: Int }; fix Div{ q, r } = Div{ q: 7, r: 1 }; q + r;';
      assert.deepEqual(evalOk(src), { type: 'Int', value: 8n });
    });

    it("'mut' makes each destructured local reassignable", () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; mut Person{ age } = p; age = 31; age;`;
      assert.deepEqual(evalOk(src), { type: 'Int', value: 31n });
    });
  });

  describe('inference', () => {
    it('gives each local the field’s declared type', () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ age } = p; age;`;
      assert.equal(typeOfLast(src), 'Int');
    });

    it('a renamed local carries the field type', () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ name: who } = p; who;`;
      assert.equal(typeOfLast(src), 'String');
    });
  });

  describe('errors', () => {
    it('a fix-destructured local is immutable (N0002 on reassign)', () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ age } = p; age = 31;`;
      assert.deepEqual(errorCodes(src), ['N0002']);
    });

    it('T0033 — a union variant is refutable, so it can’t be destructured in a binding', () => {
      const src = 'type Shape = Circle{ radius: Float } | Square{ side: Float };'
        + ' fix s: Shape = Circle{ radius: 2.0 }; fix Circle{ radius } = s;';
      assert.deepEqual(errorCodes(src), ['T0033']);
    });

    it('T0033 — the union type name itself is refutable too', () => {
      const src = 'type Shape = Circle{ radius: Float } | Square{ side: Float };'
        + ' fix s: Shape = Circle{ radius: 2.0 }; fix Shape{ radius } = s;';
      assert.deepEqual(errorCodes(src), ['T0033']);
    });

    it('T0019 — a field the record doesn’t declare', () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ height } = p;`;
      assert.deepEqual(errorCodes(src), ['T0019']);
    });

    it('T0020 — the same field named twice', () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ name, name } = p;`;
      assert.deepEqual(errorCodes(src), ['T0020']);
    });

    it('T0001 — the value isn’t of the pattern’s record type', () => {
      const src = `${PERSON} type Car = { wheels: Int }; fix c = Car{ wheels: 4 }; fix Person{ name } = c;`;
      assert.deepEqual(errorCodes(src), ['T0001']);
    });

    it('T0001 — a scalar can’t be destructured as a record', () => {
      const src = `${PERSON} fix Person{ name } = 5;`;
      assert.deepEqual(errorCodes(src), ['T0001']);
    });

    it('N0005 — an unknown type name in the pattern', () => {
      const src = 'fix Foo{ x } = 1;';
      assert.deepEqual(errorCodes(src), ['N0005']);
    });

    it('N0012 — a built-in type name in the pattern', () => {
      const src = 'fix Int{ x } = 1;';
      assert.deepEqual(errorCodes(src), ['N0012']);
    });

    it('S0028 — empty pattern braces bind nothing', () => {
      const src = `${PERSON} fix p = Person{ name: "Bob", age: 30 }; fix Person{ } = p;`;
      assert.deepEqual(errorCodes(src), ['S0028']);
    });
  });
});
