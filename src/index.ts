import * as readline from 'node:readline';
import chalk from 'chalk';
import { Lexer } from './lexer.js';

// \x01 and \x02 bracket invisible bytes so readline counts the visible
// width of the prompt correctly — without them cursor positioning breaks.
const PROMPT = `\x01${chalk.bold.green('>')}\x02 `;

process.stdout.write(chalk.bold.green('Ascent') + ' token REPL\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: PROMPT,
});

rl.prompt();

rl.on('line', (line: string) => {
  const { tokens, errorMarkers } = new Lexer(line).tokenize();

  let markerIndex = 0;
  const parts = tokens
    .filter(tok => tok.kind !== 'EOF')
    .map(tok => {
      if (tok.kind === 'ERROR') {
        const code = errorMarkers[markerIndex++]?.code ?? '?';
        return chalk.red(`[${code}]`);
      }
      return `${chalk.cyan(tok.kind)} ${chalk.yellow(`"${tok.value}"`)}`;
    });

  process.stdout.write(parts.join(`  ${chalk.dim('·')}  `) + '\n');

  rl.prompt();
});

rl.on('close', () => process.exit(0));
