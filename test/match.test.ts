import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';
import { typeToString } from '../src/types/types.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue.
function evalOk(src: string): RuntimeValue {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program, testHost());
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

// Stage 1 of 'match' (whitepaper §5): scalar subjects, literal patterns, and
// the 'else' catch-all. The subject takes no parentheses (unlike an if/while
// condition). Variant patterns arrive with unions.
describe('match — scalar literal patterns', () => {
  describe('evaluation', () => {
    it('takes the first arm whose literal equals the subject', () => {
      assert.deepEqual(evalOk('fix n = 1; match n { 0 -> "zero", 1 -> "one", else -> "many" };'),
        { type: 'String', value: 'one' });
    });

    it('falls through to else when nothing matches', () => {
      assert.deepEqual(evalOk('match 5 { 0 -> "zero", 1 -> "one", else -> "many" };'),
        { type: 'String', value: 'many' });
    });

    it('matches String subjects', () => {
      assert.deepEqual(evalOk('fix s = "b"; match s { "a" -> 1, "b" -> 2, else -> 0 };'),
        { type: 'Int', value: 2n });
    });

    it('matches Bool subjects (True/False are exhaustive, no else needed)', () => {
      assert.deepEqual(evalOk('match True { True -> "yes", False -> "no" };'),
        { type: 'String', value: 'yes' });
    });

    it('matches Float subjects', () => {
      assert.deepEqual(evalOk('fix x = 1.5; match x { 1.5 -> "a", else -> "b" };'),
        { type: 'String', value: 'a' });
    });

    it('matches negative number literals', () => {
      assert.deepEqual(evalOk('fix n = -1; match n { -1 -> "neg", 0 -> "zero", else -> "pos" };'),
        { type: 'String', value: 'neg' });
    });

    it('takes a compound expression as the subject (no parens needed)', () => {
      assert.deepEqual(evalOk('fix n = 2; match n + 1 { 3 -> "three", else -> "other" };'),
        { type: 'String', value: 'three' });
    });

    it('accepts (but does not require) parentheses around the subject', () => {
      // Parens are optional grouping now, not syntax — '(n)' is just an
      // expression that happens to be the subject.
      assert.deepEqual(evalOk('fix n = 1; match (n) { 1 -> "a", else -> "b" };'),
        { type: 'String', value: 'a' });
    });

    it('compares across the Int/Float tower, like ==', () => {
      // Subject 0 is an Int, the pattern 0.0 a Float; '0 == 0.0' is True, so it
      // matches — the same one-way numeric promotion '==' uses.
      assert.deepEqual(evalOk('match 0 { 0.0 -> "z", else -> "n" };'),
        { type: 'String', value: 'z' });
    });

    it('accepts an else-only match', () => {
      assert.deepEqual(evalOk('match 42 { else -> "always" };'),
        { type: 'String', value: 'always' });
    });

    it('allows a block as an arm body', () => {
      assert.deepEqual(evalOk('fix n = 2; match n { 0 -> { 100 }, else -> { fix m = n + 1; m } };'),
        { type: 'Int', value: 3n });
    });

    it('is an expression — its result can take a method call', () => {
      assert.deepEqual(evalOk('match 1 { 0 -> "zero", else -> "many" }.length();'),
        { type: 'Int', value: 4n });
    });
  });

  describe('type checking', () => {
    it('accepts arms whose bodies share a common type (Int/Float widen)', () => {
      assert.deepEqual(errorCodes('fix x: Float = match 1 { 0 -> 1, else -> 2.5 };'), []);
    });

    it('T0029 — a pattern that can never equal the subject', () => {
      assert.deepEqual(errorCodes('match "hi" { 0 -> "a", else -> "b" };'), ['T0029']);
    });

    it('T0030 — no else, so not every value is covered', () => {
      assert.deepEqual(errorCodes('fix n = 1; match n { 0 -> "z", 1 -> "o" };'), ['T0030']);
    });

    it('a Bool match covering True and False is exhaustive (no else)', () => {
      assert.deepEqual(errorCodes('match True { True -> 1, False -> 2 };'), []);
    });

    it('T0031 — a Bool match missing a case (finite domain)', () => {
      assert.deepEqual(errorCodes('match True { True -> 1 };'), ['T0031']);
    });

    it('T0033 — an else after full Bool coverage is unreachable (residual is Never)', () => {
      assert.deepEqual(errorCodes('match True { True -> 1, False -> 2, else -> 3 };'), ['T0033']);
    });

    it('T0032 — arms produce unrelated types', () => {
      assert.deepEqual(errorCodes('match 1 { 0 -> "zero", else -> 5 };'), ['T0032']);
    });

    it('T0033 — an arm after else is unreachable', () => {
      assert.deepEqual(errorCodes('match 1 { else -> "a", 0 -> "b" };'), ['T0033']);
    });

    it('T0033 — a duplicate literal pattern is unreachable', () => {
      assert.deepEqual(errorCodes('match 1 { 0 -> "a", 0 -> "b", else -> "c" };'), ['T0033']);
    });
  });

  describe('the dropped-value rule (whitepaper §2) applies to a statement-position match', () => {
    it('T0057 — a non-final match yielding a value is dropped', () => {
      assert.deepEqual(errorCodes('match 1 { 0 -> 1, else -> 2 }; 3;'), ['T0057']);
    });

    it("'void' discards it", () => {
      assert.deepEqual(errorCodes('void match 1 { 0 -> 1, else -> 2 }; 3;'), []);
    });
  });

  describe('syntax errors', () => {
    it('S0034 — a { must open the arms', () => {
      assert.ok(errorCodes('match 1 0 -> 1;').includes('S0034'));
    });

    it('S0035 — an arm must start with a pattern', () => {
      assert.ok(errorCodes('match 1 { -> 1, else -> 2 };').includes('S0035'));
    });

    it('S0036 — a -> must follow the pattern', () => {
      assert.ok(errorCodes('match 1 { 0 1, else -> 2 };').includes('S0036'));
    });
  });
});

const SHAPE = 'type Shape = Circle{ radius: Float } | Square{ side: Float };';
const COLOR = 'type Color = Red | Green | Blue;';

// Variant patterns (whitepaper §5) — 'match' on a tagged union: an arm names a
// variant by its tag and binds a subset of its fields. Exhaustiveness is now
// real (list every variant, or supply 'else'); the fields bind by name, reusing
// the destructuring pattern syntax.
describe('match — variant patterns', () => {
  describe('evaluation', () => {
    it('matches a variant by tag and binds its field (no else needed — all variants listed)', () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { Circle{ radius } -> radius, Square{ side } -> side };`;
      assert.deepEqual(evalOk(src), { type: 'Float', value: 2 });
    });

    it('takes the arm matching the actual tag', () => {
      const src = `${SHAPE} fix s = Square{ side: 3.0 }; match s { Circle{ radius } -> radius, Square{ side } -> side };`;
      assert.deepEqual(evalOk(src), { type: 'Float', value: 3 });
    });

    it('matches bare enum tags', () => {
      const src = `${COLOR} fix c = Green; match c { Red -> 1, Green -> 2, Blue -> 3 };`;
      assert.deepEqual(evalOk(src), { type: 'Int', value: 2n });
    });

    it('renames a bound field', () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { Circle{ radius: r } -> r * 2.0, Square{ side } -> side };`;
      assert.deepEqual(evalOk(src), { type: 'Float', value: 4 });
    });

    it('a bare tag matches a fielded variant too, binding nothing', () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { Circle -> "circle", Square -> "square" };`;
      assert.deepEqual(evalOk(src), { type: 'String', value: 'circle' });
    });

    it("an 'else' covers the variants not listed", () => {
      const src = `${COLOR} fix c = Blue; match c { Red -> "red", else -> "other" };`;
      assert.deepEqual(evalOk(src), { type: 'String', value: 'other' });
    });

    it('a single-variant record needs no else', () => {
      const src = 'type Box = { value: Int }; fix b = Box{ value: 5 }; match b { Box{ value } -> value };';
      assert.deepEqual(evalOk(src), { type: 'Int', value: 5n });
    });
  });

  describe('inference', () => {
    it('joins the arms to a common type', () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { Circle{ radius } -> radius, Square{ side } -> side };`;
      assert.equal(typeOfLast(src), 'Float');
    });
  });

  describe('errors', () => {
    it('T0031 — a variant is left unhandled with no else', () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { Circle{ radius } -> radius };`;
      assert.deepEqual(errorCodes(src), ['T0031']);
    });

    it("T0029 — a variant of a different union can't match this subject", () => {
      const src = `${SHAPE} ${COLOR} fix s = Circle{ radius: 2.0 }; match s { Red -> 1, else -> 0 };`;
      assert.deepEqual(errorCodes(src), ['T0029']);
    });

    it("T0029 — a literal can't match a union subject", () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { 0 -> 1, else -> 2 };`;
      assert.deepEqual(errorCodes(src), ['T0029']);
    });

    it('N0005 — an unknown variant tag', () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { Blob{ x } -> 1, else -> 2 };`;
      assert.deepEqual(errorCodes(src), ['N0005']);
    });

    it("T0023 — a field the variant doesn't declare", () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { Circle{ height } -> 1.0, Square{ side } -> side };`;
      assert.deepEqual(errorCodes(src), ['T0023']);
    });

    it('T0024 — the same field bound twice', () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { Circle{ radius, radius } -> radius, Square{ side } -> side };`;
      assert.deepEqual(errorCodes(src), ['T0024']);
    });

    it('T0033 — a duplicate variant arm is unreachable', () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { Circle{ radius } -> radius, Circle{ radius } -> radius, Square{ side } -> side };`;
      assert.deepEqual(errorCodes(src), ['T0033']);
    });

    it('T0033 — an arm after else is unreachable', () => {
      const src = `${COLOR} fix c = Red; match c { else -> 0, Red -> 1 };`;
      assert.deepEqual(errorCodes(src), ['T0033']);
    });

    it('T0032 — the arms produce unrelated types', () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { Circle{ radius } -> radius, Square{ side } -> "x" };`;
      assert.deepEqual(errorCodes(src), ['T0032']);
    });

    it('S0023 — empty pattern braces are banned (use the bare tag)', () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { Circle{} -> 1, else -> 2 };`;
      assert.deepEqual(errorCodes(src), ['S0023']);
    });

    it("an 'else' with only some variants listed is allowed (masks future variants)", () => {
      const src = `${SHAPE} fix s = Circle{ radius: 2.0 }; match s { Circle{ radius } -> radius, else -> 0.0 };`;
      assert.deepEqual(errorCodes(src), []);
    });

    it('an optional union is exhausted by every variant plus None (no else/binding)', () => {
      const src = `${SHAPE} fix s: Shape? = Circle{ radius: 2.0 }; match s { Circle{ radius } -> radius, Square{ side } -> side, None -> 0.0 };`;
      assert.deepEqual(errorCodes(src), []);
      assert.deepEqual(evalOk(src), { type: 'Float', value: 2 });
    });

    it('T0046 for an optional union missing one variant', () => {
      const src = `${SHAPE} fix s: Shape? = Circle{ radius: 2.0 }; match s { Circle{ radius } -> radius, None -> 0.0 };`;
      assert.deepEqual(errorCodes(src), ['T0046']);
    });
  });
});

// Matching an Optional (whitepaper §4/§5/§7): 'None' matches the absent case, and
// a bare name is the catch-all that binds the rest — placed last, after 'None' is
// peeled off, it binds the present value narrowed to T. No 'Some(...)' wrapper.
describe('match — Optional (None + binding catch-all)', () => {
  describe('evaluation', () => {
    it('binds and returns the present value (None first, binding last)', () => {
      assert.deepEqual(evalOk('fix x: String? = "hi"; match x { None -> "none", value -> value };'),
        { type: 'String', value: 'hi' });
    });

    it('takes the None arm when absent', () => {
      assert.deepEqual(evalOk('fix x: String? = None; match x { None -> "none", value -> value };'),
        { type: 'String', value: 'none' });
    });

    it('the binding name is free (anything lowercase)', () => {
      assert.deepEqual(evalOk('fix x: Int? = 7; match x { None -> 0, whatever -> whatever };'),
        { type: 'Int', value: 7n });
    });

    it('a lone binding catches everything and binds the whole optional (None included)', () => {
      // no None arm, so `v` catches None too — binds Int? and returns it
      assert.deepEqual(evalOk('fix x: Int? = None; match x { v -> v };'), { type: 'None' });
    });

    it('a present-value literal arm can precede the binding catch-all', () => {
      const src = 'fix x: Int? = 0; match x { None -> "none", 0 -> "zero", n -> "other" };';
      assert.deepEqual(evalOk(src), { type: 'String', value: 'zero' });
    });
  });

  describe('narrowing & typing', () => {
    it('narrows T? to T in the binding arm once None is peeled off', () => {
      // n is Int here (None already handled), so n + 1 typechecks and the match is Int
      assert.equal(typeOfLast('fix x: Int? = 5; match x { None -> 0, n -> n + 1 };'), 'Int');
    });

    it('a lone binding (no None arm) binds the whole optional T?', () => {
      assert.equal(typeOfLast('fix x: Int? = 5; match x { v -> v };'), 'Int?');
    });

    it('joins the arms to their common type', () => {
      assert.equal(typeOfLast('fix x: Int? = 5; match x { None -> 0.5, n -> n };'), 'Float');
    });
  });

  describe('exhaustiveness & reachability', () => {
    it('None + a binding catch-all is exhaustive (no error)', () => {
      assert.deepEqual(errorCodes('fix x: Int? = 5; match x { None -> 0, n -> n };'), []);
    });

    it('a lone binding catch-all is exhaustive on its own', () => {
      assert.deepEqual(errorCodes('fix x: Int? = 5; match x { n -> n };'), []);
    });

    it('T0046 when the present case (a catch-all) is missing', () => {
      assert.deepEqual(errorCodes('fix x: Int? = 5; match x { None -> 0 };'), ['T0046']);
    });

    it('a Bool? is exhausted by None/True/False (finite present domain, no catch-all)', () => {
      assert.deepEqual(evalOk('fix x: Bool? = True; match x { None -> -1, True -> 1, False -> 0 };'),
        { type: 'Int', value: 1n });
      assert.deepEqual(errorCodes('fix x: Bool? = True; match x { None -> -1, True -> 1, False -> 0 };'), []);
    });

    it('T0046 for a Bool? missing a present case (None+True listed, False not)', () => {
      assert.deepEqual(errorCodes('fix x: Bool? = True; match x { None -> -1, True -> 1 };'), ['T0046']);
    });

    it('T0033 — a catch-all after a Bool? is fully covered (residual is Never)', () => {
      assert.deepEqual(errorCodes('fix x: Bool? = True; match x { None -> -1, True -> 1, False -> 0, v -> 9 };'), ['T0033']);
    });

    it('T0033 — an arm after the binding catch-all is unreachable', () => {
      assert.deepEqual(errorCodes('fix x: Int? = 5; match x { None -> 0, n -> n, 0 -> 1 };'), ['T0033']);
    });

    it('T0033 — a second catch-all (else after a binding) is unreachable', () => {
      assert.deepEqual(errorCodes('fix x: Int? = 5; match x { None -> 0, n -> n, else -> 1 };'), ['T0033']);
    });

    it('T0033 for a repeated None arm', () => {
      assert.deepEqual(errorCodes('fix x: Int? = 5; match x { None -> 0, None -> 1, n -> n };'), ['T0033']);
    });
  });

  describe('binding as a general catch-all (any subject)', () => {
    it('binds the value on a non-optional subject (like else, but kept)', () => {
      assert.deepEqual(evalOk('fix x: Int = 5; match x { 0 -> 100, rest -> rest };'),
        { type: 'Int', value: 5n });
    });

    it('T0033 — a binding catch-all after a union is fully listed', () => {
      const src = `${COLOR} fix c = Green; match c { Red -> 1, Green -> 2, Blue -> 3, rest -> 9 };`;
      assert.deepEqual(errorCodes(src), ['T0033']);
    });

    it('T0029 — a None pattern on a non-Optional subject', () => {
      assert.deepEqual(errorCodes('fix x: Int = 5; match x { None -> 0, else -> 1 };'), ['T0029']);
    });
  });
});
