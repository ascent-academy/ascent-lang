import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/parser/index.js';
import { executeProgram } from '../src/interpreter.js';
import { testHost } from './support/test-host.js';

// Runs every *.asc file under test/snippets/, recursively — each
// subdirectory becomes a nested describe(), each file becomes one it().
// A snippet declares what running it should produce in a '# expect: ...'
// header, which must be the file's first line — it's an ordinary Ascent
// '#' line comment, so the file stays valid, runnable Ascent on its own
// (e.g. via 'npm start test/snippets/basics/arithmetic.asc'). Three forms:
//
//   # expect: value = 42
//     Typechecks and runs cleanly; the text the program emits — its `print`
//     lines and/or its final value, each rendered by the interpreter and joined
//     by newlines (e.g. Bool is 'True'/'False', Float always shows a '.',
//     String has no surrounding quotes).
//
//   # expect: errors = T0003, T0008
//     parse()'s diagnostic codes, in the exact order they're reported.
//
//   # expect: runtime-error = R0006
//     Typechecks cleanly, but crashes at run time with this code.
const SNIPPETS_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'snippets');

type Expectation = (
  | { kind: 'value'; text: string }
  | { kind: 'errors'; codes: string[] }
  | { kind: 'runtime-error'; code: string }
);

const HEADER = /^#\s*expect:\s*(value|errors|runtime-error)\s*=\s*(.+?)\s*$/;

const parseExpectation = (relPath: string, firstLine: string): Expectation => {
  const match = HEADER.exec(firstLine);
  if (match === null) {
    throw new Error(`${relPath}: first line must be a '# expect: value|errors|runtime-error = ...' header`);
  }
  const kind = match[1] as 'value' | 'errors' | 'runtime-error';
  const rest = match[2]!;
  switch (kind) {
    case 'value': return { kind, text: rest };
    case 'errors': return { kind, codes: rest.split(',').map(code => code.trim()) };
    case 'runtime-error': return { kind, code: rest };
  }
};

const runSnippet = async (src: string, expectation: Expectation): Promise<void> => {
  const { program, diagnostics } = parse(src);

  if (expectation.kind === 'errors') {
    assert.deepEqual(diagnostics.map(d => d.code), expectation.codes);
    return;
  }

  assert.deepEqual(diagnostics, [], `unexpected errors: ${diagnostics.map(d => d.code).join(', ')}`);
  assert.ok(program !== null, 'expected the snippet to typecheck');
  const outputs: string[] = [];
  const result = await executeProgram(program, testHost(text => outputs.push(text)));

  if (expectation.kind === 'runtime-error') {
    assert.equal(result.kind, 'error');
    if (result.kind !== 'error') throw new Error('unreachable');
    assert.equal(result.error.marker.code, expectation.code);
    return;
  }

  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  // The snippet's `value` is what running it emits: each line — a `print` call,
  // or the final value's text (both already rendered by the interpreter) —
  // joined as it appears on the console.
  assert.equal(outputs.join('\n'), expectation.text);
};

const registerDir = (dir: string): void => {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      describe(entry.name, () => registerDir(full));
      continue;
    }
    if (!entry.name.endsWith('.asc')) continue;

    it(entry.name.slice(0, -'.asc'.length), async () => {
      const src = readFileSync(full, 'utf8');
      const newline = src.indexOf('\n');
      const firstLine = newline === -1 ? src : src.slice(0, newline);
      const expectation = parseExpectation(relative(SNIPPETS_ROOT, full), firstLine);
      await runSnippet(src, expectation);
    });
  }
};

describe('Ascent snippets (test/snippets/)', () => {
  registerDir(SNIPPETS_ROOT);
});
