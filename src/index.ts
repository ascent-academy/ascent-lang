#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import { Lexer } from './lexer/index.js';
import { parse, parseTokens } from './parser/index.js';
import { typecheck } from './parser/typechecker.js';
import { formatValue } from './parser/printer.js';
import { formatTypedStmt } from './parser/typed-printer.js';
import { executeStmt, executeProgram, Environment, RuntimeValue } from './interpreter.js';
import { elaborate } from './errors/elaborate.js';
import { renderTerminal } from './errors/render.js';
import type { ArgDef } from './parser/ast.js';

// \x01 and \x02 bracket invisible bytes so readline counts the visible
// width of the prompt correctly — without them cursor positioning breaks.
const PROMPT = `\x01${chalk.bold.green('>')}\x02 `;

// Parses '--name value' pairs from argv into a name→raw-string map.
const parseCliFlags = (argv: string[]): Map<string, string> => {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(name, next);
        i++;
      } else {
        flags.set(name, 'true'); // bare flag → boolean
      }
    }
  }
  return flags;
};

// Converts raw CLI strings to RuntimeValues according to each ArgDef,
// then declares them as fixed slots. Exits on missing or ill-typed args.
const bindArgs = (argDefs: ArgDef[], cliFlags: Map<string, string>, env: Environment): void => {
  for (const def of argDefs) {
    const raw = cliFlags.get(def.name);
    if (raw === undefined) {
      process.stderr.write(`Missing argument: --${def.name} (${def.type})\n`);
      process.exit(1);
    }

    let value: RuntimeValue;
    switch (def.type) {
      case 'Int': {
        if (!/^-?\d+$/.test(raw)) {
          process.stderr.write(`--${def.name}: expected Int, got '${raw}'\n`);
          process.exit(1);
        }
        value = { type: 'Int', value: BigInt(raw) };
        break;
      }
      case 'Float': {
        const n = Number(raw);
        if (isNaN(n)) {
          process.stderr.write(`--${def.name}: expected Float, got '${raw}'\n`);
          process.exit(1);
        }
        value = { type: 'Float', value: n };
        break;
      }
      case 'Bool': {
        if (raw !== 'true' && raw !== 'false') {
          process.stderr.write(`--${def.name}: expected Bool (true or false), got '${raw}'\n`);
          process.exit(1);
        }
        value = { type: 'Bool', value: raw === 'true' };
        break;
      }
      case 'String': {
        value = { type: 'String', value: raw };
        break;
      }
    }

    env.declare(def.name, value, false);
  }
};

const runFile = async (filePath: string): Promise<void> => {
  if (!filePath.endsWith('.asc')) {
    process.stderr.write(`Expected a .asc file, got '${filePath}'\n`);
    process.exit(1);
  }

  let src: string;
  try {
    src = await readFile(filePath, 'utf8');
  } catch {
    process.stderr.write(`Cannot read file '${filePath}'\n`);
    process.exit(1);
  }

  const parseResult = parse(src);
  if (parseResult.errorMarkers.length > 0) {
    for (const marker of parseResult.errorMarkers) {
      process.stderr.write(renderTerminal(elaborate(marker, src), src, filePath) + '\n\n');
    }
    process.exit(1);
  }

  const typedProgram = parseResult.program!;
  const env = new Environment();
  if (typedProgram.args.length > 0) {
    bindArgs(typedProgram.args, parseCliFlags(process.argv.slice(3)), env);
  }

  try {
    const result = executeProgram(typedProgram, env);
    if (result.type !== 'Done') {
      process.stdout.write(formatValue(result) + '\n');
    }
  } catch (e) {
    process.stderr.write(chalk.red(String(e)) + '\n');
    process.exit(1);
  }
};

const runRepl = async (): Promise<void> => {
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

      const parseResult = parseTokens(lexResult.tokens);

      // A non-null program no longer means error-free: panic-mode
      // recovery can skip a malformed statement and still finish the
      // parse, so errorMarkers — not program nullness — is what decides
      // whether it's safe to typecheck/run.
      if (lexResult.errorMarkers.length > 0) {
        for (const marker of lexResult.errorMarkers) {
          process.stdout.write(renderTerminal(elaborate(marker, line), line, null) + '\n');
        }
      } else if (parseResult.errorMarkers.length > 0) {
        for (const marker of parseResult.errorMarkers) {
          process.stdout.write(renderTerminal(elaborate(marker, line), line, null) + '\n');
        }
      } else if (parseResult.program !== null) {
        const typeResult = typecheck(parseResult.program);
        const typeErrors = typeResult.errorMarkers;

        if (typeErrors.length > 0) {
          for (const marker of typeErrors) {
            process.stdout.write(renderTerminal(elaborate(marker, line), line, null) + '\n');
          }
        } else {
          // Print the untyped parse tree; execute the typed AST.
          // The two arrays are guaranteed to be the same length when
          // typedProgram is non-null (every statement type-checked).
          const typedStmts = typeResult.program!.stmts;
          for (let i = 0; i < typedStmts.length; i++) {
            process.stdout.write(formatTypedStmt(typedStmts[i]!) + '\n');
            try {
              const result = executeStmt(typedStmts[i]!, env);
              process.stdout.write(chalk.dim('=> ') + formatValue(result) + '\n');
            } catch (e) {
              process.stdout.write(chalk.red(String(e)) + '\n');
            }
          }
        }
      }
    }
  } catch {
    // stdin closed (Ctrl+D)
  } finally {
    rl.close();
  }
};

const main = async (): Promise<void> => {
  const filePath = process.argv[2];
  if (filePath !== undefined) {
    await runFile(filePath);
  } else {
    await runRepl();
  }
};

main();
