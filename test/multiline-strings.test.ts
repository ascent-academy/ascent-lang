import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';

// Runs a program expected to typecheck and evaluate cleanly, returning the
// String value of its last statement.
function evalStr(src: string): string {
  const { program, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  assert.equal(result.value.type, 'String');
  return (result.value as { type: 'String'; value: string }).value;
}

function errorCodes(src: string): string[] {
  return parse(src).diagnostics.map(d => d.code);
}

describe('Multiline strings (end-to-end)', () => {
  it('matches design.md\'s own worked example exactly', () => {
    const src = [
      'fix color = "red";',
      'fix poem = """',
      '    Roses are ${color},',
      '    Ascent is small.',
      '    """;',
      'poem',
    ].join('\n');
    assert.equal(evalStr(src), 'Roses are red,\nAscent is small.');
  });

  it('leaves content at margin 0 (closing """ flush left) untouched', () => {
    const src = [
      '"""',
      'line one',
      'line two',
      '"""',
    ].join('\n');
    assert.equal(evalStr(src), 'line one\nline two');
  });

  it('exempts a blank line in the middle from the indentation requirement', () => {
    const src = [
      '"""',
      '    para one',
      '',
      '    para two',
      '    """',
    ].join('\n');
    assert.equal(evalStr(src), 'para one\n\npara two');
  });

  it('preserves extra indentation beyond the common margin', () => {
    const src = [
      '"""',
      '    outer',
      '      inner',
      '    """',
    ].join('\n');
    assert.equal(evalStr(src), 'outer\n  inner');
  });

  it('keeps content on the same line as an opening delimiter with no leading newline', () => {
    assert.equal(evalStr('"""hello\nworld"""'), 'hello\nworld');
  });

  it('resolves escapes after dedent, including \\${ and \\"""', () => {
    const src = [
      '"""',
      '    literal \\${x} and \\""" done',
      '    """',
    ].join('\n');
    assert.equal(evalStr(src), 'literal ${x} and """ done');
  });

  it('evaluates a hole inside a multiline string', () => {
    const src = [
      'fix age = 21;',
      '"""',
      '    age: ${age}',
      '    """',
    ].join('\n');
    assert.equal(evalStr(src), 'age: 21');
  });

  it('evaluates a nested multiline string inside a hole', () => {
    const src = [
      '"""',
      '    outer ${',
      '    """',
      '    inner',
      '    """',
      '    } end',
      '    """',
    ].join('\n');
    assert.equal(evalStr(src), 'outer inner end');
  });

  it('reports L0006 when a line has less indentation than the closing """', () => {
    const src = [
      '"""',
      '    line one',
      '  line two',
      '    """',
    ].join('\n');
    assert.deepEqual(errorCodes(src), ['L0006']);
  });

  it('reports L0005 for a multiline string unterminated at EOF', () => {
    assert.deepEqual(errorCodes('"""abc'), ['L0005']);
  });
});
