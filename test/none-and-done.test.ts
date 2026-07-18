import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import type { RuntimeValue } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';
import { typeToString } from '../src/types/types.js';

// Runs a program expected to typecheck and evaluate cleanly, returning its
// last statement's RuntimeValue. Output goes to a discarded sink.
function evalOk(src: string): RuntimeValue {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.value;
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

// The displayed type of a program's last statement (which must be an expression).
function typeOfLast(src: string): string {
  const { program, diagnostics } = parse(src);
  assert.ok(program !== null, `expected a program, got errors: ${diagnostics.map(d => d.code).join(', ')}`);
  const last = program.stmts[program.stmts.length - 1]!;
  assert.equal(last.kind, 'expr', 'last statement must be an expression');
  if (last.kind !== 'expr') throw new Error('unreachable');
  return typeToString(last.expr.type);
}

// None and Done are easy to conflate — both are "no real payload" — but they sit
// on opposite sides of the value/non-value line:
//
//   • 'None' is NOT a standalone value. It is only the absent case of an optional
//     ('T?'), so it needs an Optional context to mean anything; on its own it has
//     no type to freeze a slot at (design.md §7).
//   • 'Done' IS a regular first-class value, of type 'Done' — the result of a
//     statement that produces nothing (a print, an assignment, an empty block).
//
// These tests pin that split from both directions.
describe('None vs Done — standalone-value status', () => {
  describe('None is not a standalone value', () => {
    it('rejects a bare None bound to an un-annotated slot (T0002)', () => {
      assert.deepEqual(errorCodes('fix x = None;'), ['T0002']);
      assert.deepEqual(errorCodes('mut x = None;'), ['T0002']);
    });

    it('rejects a list of nothing but None — it would freeze (T0002)', () => {
      assert.deepEqual(errorCodes('fix xs = [None];'), ['T0002']);
      // …at any nesting depth, exactly like '[[]]' for the empty-list case.
      assert.deepEqual(errorCodes('fix xs = [[None]];'), ['T0002']);
    });

    it('rejects None flowing through a slot into another (still no type)', () => {
      // 'a' freezes at None (its own T0002), so 'b = a' is a bare None again and
      // needs its own annotation too — one T0002 per un-annotated None slot.
      assert.deepEqual(errorCodes('fix a = None; fix b = a;'), ['T0002', 'T0002']);
    });

    it('is not a type name — it can\'t be written as an annotation (S0012)', () => {
      assert.deepEqual(errorCodes('fix x: None = None;'), ['S0012']);
    });

    it('is not a function return type — a value-less function returns Done (S0012)', () => {
      assert.deepEqual(errorCodes('fix f = fn(): None { None };'), ['S0012']);
    });

    it('rejects None assigned to a non-Optional slot (T0001)', () => {
      assert.deepEqual(errorCodes('fix x: String = None;'), ['T0001']);
    });
  });

  describe('None is not a type of its own — it is the empty optional', () => {
    // 'None' has no lattice kind: the literal's type is 'Optional<Never>', which
    // displays as 'None' but is structurally a real optional, so 'List<None>'
    // can never form — a list of Nones is 'List<Never?>', displayed 'List<None>'
    // only as a transient (always annotation-required) type.
    it('the None literal displays as None', () => {
      assert.equal(typeOfLast('None;'), 'None');
    });

    it('a bare value and None share the optional type in a match/??', () => {
      // '??' on None yields the default's type — None contributes only its
      // (empty) present side, exactly as 'Optional<Never>' should.
      assert.equal(typeOfLast('None ?? 3;'), 'Int');
    });

    it('an inferred optional from a method displays with its element (String?)', () => {
      assert.equal(typeOfLast('fix c = "hi".first(); c;'), 'String?');
    });

    it('an annotated list of optionals keeps its element type', () => {
      assert.equal(typeOfLast('fix xs: List<Int?> = [None]; xs;'), 'List<Int?>');
    });
  });

  // A value and a None fold into an optional wherever several values are joined
  // into one type — a list literal, an if/else, a match's arms. (The strict
  // "are these two comparable at all" check behind '==' and match *patterns* is
  // untouched: 'Int' and 'None' still don't mix there.)
  describe('a value and None join into an optional', () => {
    it('a list literal mixing None and a value is a List of optionals', () => {
      assert.equal(typeOfLast('[None, 1];'), 'List<Int?>');
      assert.equal(typeOfLast('[1, None];'), 'List<Int?>');           // order-independent
      assert.equal(typeOfLast('[1, None, 2];'), 'List<Int?>');        // None in the middle
    });

    it('joins the present values through the numeric tower first', () => {
      assert.equal(typeOfLast('[None, 1, 2.5];'), 'List<Float?>');    // Int+Float → Float, then optional
    });

    it('joins an already-optional element with a bare value', () => {
      assert.equal(typeOfLast('fix x: Int? = 3; [x, 4];'), 'List<Int?>');
    });

    it('an if/else with a None branch and a value branch is optional', () => {
      assert.equal(typeOfLast('if (True) { None } else { 5 };'), 'Int?');
    });

    it("a match with a None arm and a value arm is optional", () => {
      assert.equal(typeOfLast('match 3 { 0 -> None, else -> 7 };'), 'Int?');
    });

    it('the joined list evaluates correctly (None and value coexist)', () => {
      assert.deepEqual(evalOk('fix xs = [None, 1, None, 2]; xs.length();'), { type: 'Int', value: 4n });
      assert.deepEqual(evalOk('fix xs = [None, 1]; xs[0] == None;'), { type: 'Bool', value: true });
      assert.deepEqual(evalOk('fix xs = [None, 1]; xs[1] == None;'), { type: 'Bool', value: false });
    });

    it('still rejects a list of two genuinely unrelated types (T0005)', () => {
      assert.deepEqual(errorCodes('fix xs = [1, "a"];'), ['T0005']);
    });

    it('does not loosen match-pattern or == disjointness', () => {
      // A None pattern on a non-optional subject is still incompatible (T0029)…
      assert.deepEqual(errorCodes('fix x: Int = 5; match x { None -> 0, else -> 1 };'), ['T0029']);
      // …and comparing a bare value to None is still an operand error (T0008).
      assert.deepEqual(errorCodes('1 == None;'), ['T0008']);
    });
  });

  describe('None is fine wherever an Optional gives it meaning', () => {
    it('is the initial value of an annotated Optional slot', () => {
      assert.deepEqual(evalOk('fix x: String? = None; x;'), { type: 'None' });
    });

    it('fills a List<T?> literal (the annotation gives the element type)', () => {
      assert.deepEqual(evalOk('fix xs: List<Int?> = [None]; xs;'),
        { type: 'List', elements: [{ type: 'None' }] });
    });

    it('is inferred fine when a method yields an Optional (no annotation needed)', () => {
      // '.first()' is String?, a real Optional — the slot infers it without help.
      assert.deepEqual(evalOk('fix c = "hi".first(); c;'), { type: 'String', value: 'h' });
      assert.deepEqual(evalOk('fix c = "".first(); c;'), { type: 'None' });
    });

    it('compares against an Optional slot', () => {
      assert.deepEqual(evalOk('fix x: Int? = None; x == None;'), { type: 'Bool', value: true });
      assert.deepEqual(evalOk('fix x: Int? = 5; x == None;'), { type: 'Bool', value: false });
    });

    it('defaults via ??', () => {
      assert.deepEqual(evalOk('None ?? "hi";'), { type: 'String', value: 'hi' });
    });
  });

  describe('Done is a regular first-class value', () => {
    it('binds to an un-annotated slot and yields a Done value', () => {
      assert.deepEqual(evalOk('fix y = Done; y;'), { type: 'Done' });
      assert.deepEqual(evalOk('mut y = Done; y;'), { type: 'Done' });
    });

    it('has a writable type — Done annotates a slot', () => {
      assert.deepEqual(evalOk('fix y: Done = Done; y;'), { type: 'Done' });
    });

    it('is a valid list element type (List<Done> is a real type)', () => {
      assert.deepEqual(evalOk('fix ds = [Done, Done]; ds.length();'), { type: 'Int', value: 2n });
    });

    it('compares by value', () => {
      assert.deepEqual(evalOk('Done == Done;'), { type: 'Bool', value: true });
    });

    it('is a function return type — the value-less function form', () => {
      const result = evalOk('fix f = fn(): Done { Done }; f();');
      assert.deepEqual(result, { type: 'Done' });
    });

    it('passes through a slot into another', () => {
      assert.deepEqual(evalOk('fix a = Done; fix b = a; b;'), { type: 'Done' });
    });
  });
});
