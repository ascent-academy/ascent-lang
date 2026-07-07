import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';

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

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

// Stage 1 of 'match' (whitepaper §5): scalar subjects, literal patterns, and
// the 'else' catch-all. The subject takes no parentheses (unlike an if/while
// condition). Variant patterns arrive with unions.
describe('match — scalar literal patterns', () => {
  describe('evaluation', () => {
    it('takes the first arm whose literal equals the subject', () => {
      assert.deepEqual(evalOk('fix n = 1; match n { 0 -> "zero"; 1 -> "one"; else -> "many" };'),
        { type: 'String', value: 'one' });
    });

    it('falls through to else when nothing matches', () => {
      assert.deepEqual(evalOk('match 5 { 0 -> "zero"; 1 -> "one"; else -> "many" };'),
        { type: 'String', value: 'many' });
    });

    it('matches String subjects', () => {
      assert.deepEqual(evalOk('fix s = "b"; match s { "a" -> 1; "b" -> 2; else -> 0 };'),
        { type: 'Int', value: 2n });
    });

    it('matches Bool subjects (else still required in stage 1)', () => {
      assert.deepEqual(evalOk('match True { True -> "yes"; False -> "no"; else -> "?" };'),
        { type: 'String', value: 'yes' });
    });

    it('matches Float subjects', () => {
      assert.deepEqual(evalOk('fix x = 1.5; match x { 1.5 -> "a"; else -> "b" };'),
        { type: 'String', value: 'a' });
    });

    it('matches negative number literals', () => {
      assert.deepEqual(evalOk('fix n = -1; match n { -1 -> "neg"; 0 -> "zero"; else -> "pos" };'),
        { type: 'String', value: 'neg' });
    });

    it('takes a compound expression as the subject (no parens needed)', () => {
      assert.deepEqual(evalOk('fix n = 2; match n + 1 { 3 -> "three"; else -> "other" };'),
        { type: 'String', value: 'three' });
    });

    it('accepts (but does not require) parentheses around the subject', () => {
      // Parens are optional grouping now, not syntax — '(n)' is just an
      // expression that happens to be the subject.
      assert.deepEqual(evalOk('fix n = 1; match (n) { 1 -> "a"; else -> "b" };'),
        { type: 'String', value: 'a' });
    });

    it('compares across the Int/Float tower, like ==', () => {
      // Subject 0 is an Int, the pattern 0.0 a Float; '0 == 0.0' is True, so it
      // matches — the same one-way numeric promotion '==' uses.
      assert.deepEqual(evalOk('match 0 { 0.0 -> "z"; else -> "n" };'),
        { type: 'String', value: 'z' });
    });

    it('accepts an else-only match', () => {
      assert.deepEqual(evalOk('match 42 { else -> "always" };'),
        { type: 'String', value: 'always' });
    });

    it('allows a block as an arm body', () => {
      assert.deepEqual(evalOk('fix n = 2; match n { 0 -> { 100 }; else -> { fix m = n + 1; m } };'),
        { type: 'Int', value: 3n });
    });

    it('is an expression — its result can take a method call', () => {
      assert.deepEqual(evalOk('match 1 { 0 -> "zero"; else -> "many" }.length();'),
        { type: 'Int', value: 4n });
    });
  });

  describe('type checking', () => {
    it('accepts arms whose bodies share a common type (Int/Float widen)', () => {
      assert.deepEqual(errorCodes('fix x: Float = match 1 { 0 -> 1; else -> 2.5 };'), []);
    });

    it('T0028 — a pattern that can never equal the subject', () => {
      assert.deepEqual(errorCodes('match "hi" { 0 -> "a"; else -> "b" };'), ['T0028']);
    });

    it('T0029 — no else, so not every value is covered', () => {
      assert.deepEqual(errorCodes('fix n = 1; match n { 0 -> "z"; 1 -> "o" };'), ['T0029']);
    });

    it('T0029 — a Bool match still needs an else in stage 1', () => {
      assert.deepEqual(errorCodes('match True { True -> 1; False -> 2 };'), ['T0029']);
    });

    it('T0030 — arms produce unrelated types', () => {
      assert.deepEqual(errorCodes('match 1 { 0 -> "zero"; else -> 5 };'), ['T0030']);
    });

    it('T0031 — an arm after else is unreachable', () => {
      assert.deepEqual(errorCodes('match 1 { else -> "a"; 0 -> "b" };'), ['T0031']);
    });

    it('T0031 — a duplicate literal pattern is unreachable', () => {
      assert.deepEqual(errorCodes('match 1 { 0 -> "a"; 0 -> "b"; else -> "c" };'), ['T0031']);
    });
  });

  describe('the dropped-value rule (whitepaper §2) applies to a statement-position match', () => {
    it('T0025 — a non-final match yielding a value is dropped', () => {
      assert.deepEqual(errorCodes('match 1 { 0 -> 1; else -> 2 }; 3;'), ['T0025']);
    });

    it("'void' discards it", () => {
      assert.deepEqual(errorCodes('void match 1 { 0 -> 1; else -> 2 }; 3;'), []);
    });
  });

  describe('syntax errors', () => {
    it('S0024 — a { must open the arms', () => {
      assert.ok(errorCodes('match 1 0 -> 1;').includes('S0024'));
    });

    it('S0025 — an arm must start with a pattern', () => {
      assert.ok(errorCodes('match 1 { -> 1; else -> 2 };').includes('S0025'));
    });

    it('S0026 — a -> must follow the pattern', () => {
      assert.ok(errorCodes('match 1 { 0 1; else -> 2 };').includes('S0026'));
    });
  });
});
