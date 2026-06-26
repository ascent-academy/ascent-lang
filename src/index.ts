import * as readline from 'node:readline';
import { Lexer } from './lexer.js';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  green: '\x1b[32m',
};

// \x01 and \x02 bracket invisible bytes so readline counts the visible
// width of the prompt correctly — without them cursor positioning breaks.
const PROMPT = `\x01${c.bold}${c.green}\x02>\x01${c.reset}\x02 `;

process.stdout.write(`${c.bold}${c.green}Ascent${c.reset} token REPL\n`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: PROMPT,
});

rl.prompt();

rl.on('line', (line: string) => {
  const { tokens, errorMarkers: diagnostics } = new Lexer(line).tokenize();

  let diagIndex = 0;
  const parts = tokens
    .filter(tok => tok.kind !== 'EOF')
    .map(tok => {
      if (tok.kind === 'ERROR') {
        const code = diagnostics[diagIndex++]?.code ?? '?';
        return `${c.red}[${code}]${c.reset}`;
      }
      return `${c.cyan}${tok.kind}${c.reset} ${c.yellow}"${tok.value}"${c.reset}`;
    });

  process.stdout.write(parts.join(`  ${c.dim}·${c.reset}  `) + '\n');

  rl.prompt();
});

rl.on('close', () => process.exit(0));
