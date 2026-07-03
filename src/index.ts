import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';
import { Lexer } from './lexer/index.js';
import { Parser } from './parser.js';
import { formatStmt, formatValue } from './printer.js';
import { executeStmt, Environment } from './interpreter.js';

// \x01 and \x02 bracket invisible bytes so readline counts the visible
// width of the prompt correctly — without them cursor positioning breaks.
const PROMPT = `\x01${chalk.bold.green('>')}\x02 `;

const main = async (): Promise<void> => {
  process.stdout.write(chalk.bold.green('Ascent') + ' REPL\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const env = new Environment();

  try {
    while (true) {
      const line = await rl.question(PROMPT);

      const lexResult = new Lexer(line).tokenize();
      let markerIndex = 0;
      const tokenParts = lexResult.tokens
        .filter(tok => tok.kind !== 'EOF')
        .map(tok => {
          if (tok.kind === 'ERROR') {
            const code = lexResult.errorMarkers[markerIndex++]?.code ?? '?';
            return chalk.red(`[${code}]`);
          }
          return `[${chalk.cyan(tok.kind)} ${chalk.yellow(`"${tok.value}"`)}]`;
        });

      process.stdout.write(tokenParts.join(`  ${chalk.dim('·')}  `) + '\n');

      const parseResult = new Parser(lexResult.tokens).parse();

      if (parseResult.program !== null) {
        for (const stmt of parseResult.program.stmts) {
          process.stdout.write(formatStmt(stmt) + '\n');
          try {
            const result = executeStmt(stmt, env);
            process.stdout.write(chalk.dim('=> ') + formatValue(result) + '\n');
          } catch (e) {
            process.stdout.write(chalk.red(String(e)) + '\n');
          }
        }
      } else if (lexResult.errorMarkers.length === 0) {
        // Only show parser errors when the lexer succeeded — if the lexer
        // already flagged something, the parser error is a downstream echo.
        for (const marker of parseResult.errorMarkers) {
          process.stdout.write(chalk.red(`[${marker.code}]`) + '\n');
        }
      }
    }
  } catch {
    // stdin closed (Ctrl+D)
  } finally {
    rl.close();
  }
};

main();
