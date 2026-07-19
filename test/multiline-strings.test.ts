import assert from 'node:assert/strict';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import { testHost, testCapabilities } from './support/test-host.js';

// Runs a program expected to typecheck and evaluate cleanly, returning the
// String value of its last statement.
async function evalStr(src: string): Promise<string> {
  const { program, diagnostics } = parse(src, testCapabilities);
  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the program to typecheck');
  const result = await executeProgram(program, testHost());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  assert.equal(result.value.type, 'String');
  return (result.value as { type: 'String'; value: string }).value;
}

function errorCodes(src: string): string[] {
  return parse(src, testCapabilities).diagnostics.map(d => d.code);
}

describe('Multiline strings (end-to-end)', () => {
  it('matches design.md\'s own worked example exactly', async () => {
    const src = [
      'fix color = "red";',
      'fix poem = """',
      '    Roses are ${color},',
      '    Ascent is small.',
      '    """;',
      'poem',
    ].join('\n');
    assert.equal(await evalStr(src), 'Roses are red,\nAscent is small.');
  });

  it('leaves content at margin 0 (closing """ flush left) untouched', async () => {
    const src = [
      '"""',
      'line one',
      'line two',
      '"""',
    ].join('\n');
    assert.equal(await evalStr(src), 'line one\nline two');
  });

  it('exempts a blank line in the middle from the indentation requirement', async () => {
    const src = [
      '"""',
      '    para one',
      '',
      '    para two',
      '    """',
    ].join('\n');
    assert.equal(await evalStr(src), 'para one\n\npara two');
  });

  it('preserves extra indentation beyond the common margin', async () => {
    const src = [
      '"""',
      '    outer',
      '      inner',
      '    """',
    ].join('\n');
    assert.equal(await evalStr(src), 'outer\n  inner');
  });

  it('keeps content on the same line as an opening delimiter with no leading newline', async () => {
    assert.equal(await evalStr('"""hello\nworld"""'), 'hello\nworld');
  });

  it('resolves escapes after dedent, including \\${ and \\"""', async () => {
    const src = [
      '"""',
      '    literal \\${x} and \\""" done',
      '    """',
    ].join('\n');
    assert.equal(await evalStr(src), 'literal ${x} and """ done');
  });

  it('evaluates a hole inside a multiline string', async () => {
    const src = [
      'fix age = 21;',
      '"""',
      '    age: ${age}',
      '    """',
    ].join('\n');
    assert.equal(await evalStr(src), 'age: 21');
  });

  it('evaluates a nested multiline string inside a hole', async () => {
    const src = [
      '"""',
      '    outer ${',
      '    """',
      '    inner',
      '    """',
      '    } end',
      '    """',
    ].join('\n');
    assert.equal(await evalStr(src), 'outer inner end');
  });

  it('reports L0006 when a line has less indentation than the closing """', async () => {
    const src = [
      '"""',
      '    line one',
      '  line two',
      '    """',
    ].join('\n');
    assert.deepEqual(errorCodes(src), ['L0006']);
  });

  it('reports L0005 for a multiline string unterminated at EOF', async () => {
    assert.deepEqual(errorCodes('"""abc'), ['L0005']);
  });
});
