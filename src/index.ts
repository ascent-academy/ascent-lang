import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { elaborate } from './elaborate.js';
import { Interpreter } from './interpreter.js';
import type { RuntimeValue } from './interpreter.js';

const src = `
fix x = 1 + 2 * 3;
mut y = -x;
y = y + 1;
not true;
`;

const lexResult = new Lexer(src).tokenize();
const parseResult = new Parser(lexResult.tokens).parse();

const allDiags = [...lexResult.diagnostics, ...parseResult.diagnostics];
if (allDiags.length > 0) {
  for (const raw of allDiags) {
    const d = elaborate(raw, src);
    console.log(`[${d.code}] ${d.message}`);
    if (d.explanation) console.log(`       ${d.explanation}`);
  }
} else {
  const { results, diagnostics } = new Interpreter().run(parseResult.program);

  for (const value of results) {
    if (value !== null) console.log(`=> ${formatValue(value)}`);
  }

  for (const raw of diagnostics) {
    const d = elaborate(raw, src);
    console.log(`[${d.code}] ${d.message}`);
    if (d.explanation) console.log(`       ${d.explanation}`);
  }
}

function formatValue(v: RuntimeValue): string {
  switch (v.type) {
    case 'int':    return `${v.value}`;
    case 'float':  return `${v.value}`;
    case 'bool':   return `${v.value}`;
    case 'string': return JSON.stringify(v.value);
  }
}
