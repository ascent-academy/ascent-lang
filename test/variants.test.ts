import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { typeToString } from '../src/types/types.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue. Output is streamed to a sink we discard.
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

const SHAPE = 'type Shape = Circle{ radius: Float } | Square{ side: Float };';

describe('Type variants (end-to-end)', () => {
  describe('declaration & construction', () => {
    it('constructs a variant, tagged by its constructor name', () => {
      assert.deepEqual(
        evalOk(`${SHAPE} Circle{ radius: 2.0 };`),
        { type: 'Record', name: 'Circle', fields: new Map<string, RuntimeValue>([['radius', { type: 'Float', value: 2 }]]) },
      );
    });

    it("gives every variant the whole union's type, not the variant's tag", () => {
      assert.equal(typeOfLast(`${SHAPE} Circle{ radius: 2.0 };`), 'Shape');
      assert.equal(typeOfLast(`${SHAPE} Square{ side: 3.0 };`), 'Shape');
    });

    it('infers the union type on an unannotated slot', () => {
      assert.equal(typeOfLast(`${SHAPE} fix s = Circle{ radius: 2.0 }; s;`), 'Shape');
    });

    it('accepts a leading pipe before the first variant', () => {
      const src = 'type Shape =\n | Circle{ radius: Float }\n | Square{ side: Float };\n Square{ side: 3.0 };';
      assert.equal(typeOfLast(src), 'Shape');
    });

    it('widens an Int into a variant\'s Float field, as a record field does', () => {
      assert.deepEqual(
        evalOk(`${SHAPE} Circle{ radius: 5 };`),
        { type: 'Record', name: 'Circle', fields: new Map<string, RuntimeValue>([['radius', { type: 'Float', value: 5 }]]) },
      );
    });

    it('supports a braceless zero-field variant (an enum case)', () => {
      assert.equal(typeOfLast('type Toggle = On | Off; On;'), 'Toggle');
    });

    it('mixes braceless and fielded variants in one union', () => {
      assert.equal(typeOfLast('type Tree = Empty | Node{ value: Int }; Node{ value: 3 };'), 'Tree');
      assert.equal(typeOfLast('type Tree = Empty | Node{ value: Int }; Empty;'), 'Tree');
    });

    it('treats the explicit single-variant form like the record sugar', () => {
      // 'type Box = Box{ … }' names its sole constructor explicitly; it builds
      // and reads exactly like the bare-brace 'type Box = { … }'.
      assert.deepEqual(
        evalOk('type Box = Box{ v: Int }; fix b = Box{ v: 7 }; b.v;'),
        { type: 'Int', value: 7n },
      );
    });

    it('resolves a self-referential union field (a recursive tree)', () => {
      const src = `
        type Tree = Leaf{ value: Int } | Branch{ left: Tree, right: Tree };
        fix t = Branch{ left: Leaf{ value: 1 }, right: Leaf{ value: 2 } };
        t == t;
      `;
      assert.deepEqual(evalOk(src), { type: 'Bool', value: true });
    });
  });

  describe('variants in collections & equality', () => {
    it('infers List<Shape> from a list of different variants', () => {
      assert.equal(typeOfLast(`${SHAPE} [Circle{ radius: 1.0 }, Square{ side: 2.0 }];`), 'List<Shape>');
    });

    it('compares two variants of a union structurally with ==', () => {
      assert.deepEqual(evalOk(`${SHAPE} Circle{ radius: 2.0 } == Circle{ radius: 2.0 };`), { type: 'Bool', value: true });
      // Same union type, different variants — unequal (different tags).
      assert.deepEqual(evalOk(`${SHAPE} Circle{ radius: 2.0 } == Square{ side: 2.0 };`), { type: 'Bool', value: false });
      // Same variant, different field value.
      assert.deepEqual(evalOk(`${SHAPE} Circle{ radius: 2.0 } == Circle{ radius: 3.0 };`), { type: 'Bool', value: false });
    });
  });

  describe('branch-join', () => {
    it('joins two variants of a union to the union type in an if', () => {
      const src = `${SHAPE} fix c = True; if (c) { Circle{ radius: 1.0 } } else { Square{ side: 2.0 } };`;
      assert.equal(typeOfLast(src), 'Shape');
    });

    it('joins two variants of a union to the union type in a match', () => {
      const src = `${SHAPE} fix n = 1; match (n) { 1 -> Circle{ radius: 1.0 }, else -> Square{ side: 2.0 } };`;
      assert.equal(typeOfLast(src), 'Shape');
    });

    it('evaluates the joined if to the value of the taken branch', () => {
      const src = `${SHAPE} fix c = True; if (c) { Circle{ radius: 1.0 } } else { Square{ side: 2.0 } };`;
      assert.deepEqual(evalOk(src), {
        type: 'Record', name: 'Circle',
        fields: new Map<string, RuntimeValue>([['radius', { type: 'Float', value: 1 }]]),
      });
    });
  });

  describe('enums (braceless zero-field variants)', () => {
    it('constructs a bare enum case, tagged by its name, with no fields', () => {
      assert.deepEqual(
        evalOk('type Color = Red | Green | Blue; Green;'),
        { type: 'Record', name: 'Green', fields: new Map<string, RuntimeValue>() },
      );
    });

    it('gives every case the enum type', () => {
      assert.equal(typeOfLast('type Color = Red | Green | Blue; Red;'), 'Color');
    });

    it('compares enum cases structurally with ==', () => {
      assert.deepEqual(evalOk('type Color = Red | Green | Blue; Red == Red;'), { type: 'Bool', value: true });
      assert.deepEqual(evalOk('type Color = Red | Green | Blue; Red == Green;'), { type: 'Bool', value: false });
    });

    it('collects enum cases into a List of the enum type', () => {
      assert.equal(typeOfLast('type Color = Red | Green | Blue; [Red, Green, Blue];'), 'List<Color>');
    });

    it('supports a single braceless variant (a unit type)', () => {
      assert.equal(typeOfLast('type Unit = Unit; Unit;'), 'Unit');
    });
  });

  describe('field-access rule', () => {
    it('reports T0028 for reading a field on a multi-variant union', () => {
      assert.deepEqual(errorCodes(`${SHAPE} fix s = Circle{ radius: 2.0 }; s.radius;`), ['T0028']);
    });

    it('still allows field access on a single-variant type', () => {
      assert.deepEqual(evalOk('type Box = Box{ v: Int }; Box{ v: 9 }.v;'), { type: 'Int', value: 9n });
    });
  });

  describe('construction errors', () => {
    it('reports N0011 for building the union by its type name', () => {
      assert.deepEqual(errorCodes(`${SHAPE} Shape{ radius: 2.0 };`), ['N0011']);
    });

    it('reports N0005 for an unknown constructor', () => {
      assert.deepEqual(errorCodes(`${SHAPE} Triangle{ base: 1.0 };`), ['N0005']);
    });

    it('reports N0012 for a built-in type name used as a value', () => {
      assert.deepEqual(errorCodes('fix x = Int; 1;'), ['N0012']);
      assert.deepEqual(errorCodes('List{ x: 1 };'), ['N0012']);
    });

    it('reports T0022 for a missing field in a variant', () => {
      assert.deepEqual(errorCodes(`${SHAPE} Circle{};`), ['T0022']);
    });

    it('reports T0023 for an unknown field in a variant', () => {
      assert.deepEqual(errorCodes(`${SHAPE} Circle{ radius: 2.0, colour: "red" };`), ['T0023']);
    });

    it('reports T0025 for a field value of the wrong type', () => {
      assert.deepEqual(errorCodes(`${SHAPE} Circle{ radius: "big" };`), ['T0025']);
    });

    it("checks each field against its own variant's declaration", () => {
      // 'side' belongs to Square, not Circle — so it's unknown on Circle.
      assert.ok(errorCodes(`${SHAPE} Circle{ side: 2.0 };`).includes('T0023'));
    });
  });

  describe('declaration errors', () => {
    it('reports N0009 for two variants with the same name', () => {
      assert.deepEqual(errorCodes('type T = A{ x: Int } | A{ y: Int };'), ['N0009']);
    });

    it('reports N0010 for a variant name already owned by another type', () => {
      assert.deepEqual(errorCodes('type A = C{ x: Int }; type B = C{ y: Int };'), ['N0010']);
    });

    it('reports N0008 for a variant that reuses a built-in type name', () => {
      assert.deepEqual(errorCodes('type Bad = Int{ x: Int };'), ['N0008']);
    });

    it('reports N0007 for a duplicate field within one variant', () => {
      assert.deepEqual(errorCodes('type T = A{ x: Int, x: Float } | B{ y: Int };'), ['N0007']);
    });

    it('allows two different variants to share a field name', () => {
      assert.equal(typeOfLast('type Pair = Left{ v: Int } | Right{ v: Int }; Left{ v: 1 };'), 'Pair');
    });
  });

  describe('syntax errors', () => {
    it('reports S0022 when a variant name is missing after a pipe', () => {
      assert.ok(errorCodes('type Shape = Circle{ radius: Float } | ;').includes('S0022'));
    });

    it('reports S0022 when the right-hand side is neither a brace nor a variant', () => {
      assert.ok(errorCodes('type T = 5;').includes('S0022'));
    });
  });

  describe('empty braces are banned (one way to write a zero-field variant)', () => {
    it('reports S0023 for an empty-brace variant in a declaration', () => {
      assert.deepEqual(errorCodes('type Color = Red{} | Green{};'), ['S0023', 'S0023']);
    });

    it('reports S0023 for an empty-brace record head', () => {
      assert.deepEqual(errorCodes('type Empty = {};'), ['S0023']);
    });

    it('reports S0023 for building a zero-field variant with empty braces', () => {
      assert.deepEqual(errorCodes('type Color = Red | Green; Red{};'), ['S0023']);
    });

    it('still reports T0022 (not S0023) for a fielded variant built with empty braces', () => {
      // 'Circle{}' looks the same as 'Red{}' but Circle declares fields, so the
      // mistake is a missing field, not empty-braces.
      assert.deepEqual(errorCodes(`${SHAPE} Circle{};`), ['T0022']);
    });
  });
});
