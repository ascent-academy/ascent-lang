import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';

// Runs a program expected to typecheck and evaluate cleanly, returning the
// String value of its last statement.
function evalStr(src: string): string {
  const { program, errorMarkers } = parse(src);
  assert.deepEqual(errorMarkers, [], `unexpected errors: ${errorMarkers.map(m => m.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program);
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  assert.equal(result.value.type, 'String');
  return (result.value as { type: 'String'; value: string }).value;
}

function errorCodes(src: string): string[] {
  return parse(src).errorMarkers.map(m => m.code);
}

describe('String interpolation (end-to-end)', () => {
  it('leaves a plain String with no holes unchanged', () => {
    assert.equal(evalStr('"just text";'), 'just text');
  });

  it('splices a String-typed slot into the surrounding text', () => {
    assert.equal(evalStr('fix name = "Ada"; "Hi ${name}!";'), 'Hi Ada!');
  });

  it('evaluates multiple holes, each converted with .toStr()', () => {
    assert.equal(
      evalStr('fix age = 21; "Age: ${age.toStr()}, next year: ${(age + 1).toStr()}.";'),
      'Age: 21, next year: 22.',
    );
  });

  it('accepts an Int hole directly, with no .toStr() needed', () => {
    assert.equal(evalStr('fix age = 21; "Age: ${age}.";'), 'Age: 21.');
  });

  it('accepts a Float hole directly, with no .toStr() needed', () => {
    assert.equal(evalStr('"Pi is about ${3.14}.";'), 'Pi is about 3.14.');
  });

  it('keeps the decimal point on a whole-number Float, via a hole and via .toStr()', () => {
    assert.equal(evalStr('"total: ${3.0}";'), 'total: 3.0');
    assert.equal(evalStr('"total: ${3.0.toStr()}";'), 'total: 3.0');
  });

  it('accepts a Bool hole directly, with no .toStr() needed', () => {
    assert.equal(evalStr('fix ok = True; "ok = ${ok}.";'), 'ok = True.');
  });

  it('evaluates a hole containing an if-expression with its own blocks', () => {
    assert.equal(
      evalStr('fix n = 4; "n is ${if (n mod 2 == 0) { "even" } else { "odd" }}.";'),
      'n is even.',
    );
  });

  it('evaluates a String literal nested inside a hole', () => {
    assert.equal(evalStr('"outer ${"inner"} end";'), 'outer inner end');
  });

  it('resolves \\${ to a literal "${" with no hole', () => {
    assert.equal(evalStr(String.raw`"literal \${x}";`), 'literal ${x}');
  });

  it('reports T0014 when a hole holds a non-scalar value (a List)', () => {
    assert.deepEqual(errorCodes('fix xs = [1, 2]; "xs: ${xs}";'), ['T0014']);
  });

  it('reports T0014 when a hole holds None', () => {
    assert.deepEqual(errorCodes('"nothing: ${None}";'), ['T0014']);
  });

  it('reports S0015 when a hole holds more than one value', () => {
    assert.deepEqual(errorCodes('"${ 1 2 }";'), ['S0015']);
  });

  it('reports L0006 when an interpolation is never closed', () => {
    assert.deepEqual(errorCodes('"hi ${name'), ['L0006']);
  });
});
