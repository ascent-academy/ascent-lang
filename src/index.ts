import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { elaborate } from './elaborate.js';

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
  console.log('Diagnostics:');
  for (const raw of allDiags) {
    const d = elaborate(raw, src);
    console.log(`  [${d.code}] ${d.message}`);
    if (d.explanation) console.log(`         ${d.explanation}`);
  }
} else {
  // BigInt serialisation: JSON.stringify rejects BigInt values by default.
  const replacer = (_: string, v: unknown) =>
    typeof v === 'bigint' ? `${v}n` : v;
  console.log(JSON.stringify(parseResult.program, replacer, 2));
}
