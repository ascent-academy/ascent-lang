#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import { Lexer } from './lexer/index.js';
import { isTrivia } from './lexer/token.js';
import { parse, parseTokens } from './parser/index.js';
import { typecheck, TypeEnv } from './check/index.js';
import { formatValue } from './parser/printer.js';
import { formatTypedStmt } from './parser/typed-printer.js';
import { executeStmt, executeProgram, Environment, ProgramInputs, RuntimeValue } from './interpreter.js';
import { isInt64 } from './interpreter/arithmetic.js';
import { elaborate } from './errors/elaborate.js';
import { renderTerminal } from './errors/render.js';
import { RuntimeError } from './errors/runtime-error.js';
import type { ProgramArg } from './parser/ast.js';
import { terminalHost } from './terminal-host.js';

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

// Converts raw CLI strings to RuntimeValues according to each ArgDef.
// Exits on missing or ill-typed args.
const bindArgs = (argDefs: ProgramArg[], cliFlags: Map<string, string>): ProgramInputs => {
  const inputs = new ProgramInputs(argDefs);
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
        // Validate at the boundary (whitepaper §11): an Int argument must fit
        // 64 bits, or the program would run with a value no Int can hold —
        // exactly the invariant the overflow trap protects everywhere else.
        const parsed = BigInt(raw);
        if (!isInt64(parsed)) {
          process.stderr.write(`--${def.name}: '${raw}' is outside the range of Int (a 64-bit whole number)\n`);
          process.exit(1);
        }
        value = { type: 'Int', value: parsed };
        break;
      }
      case 'Float': {
        const n = Number(raw);
        if (isNaN(n) || !isFinite(n)) {
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

    inputs.set(def.name, value);
  }
  return inputs;
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

  const parseResult = parse(src, terminalHost.capabilities);
  if (parseResult.diagnostics.length > 0) {
    for (const diagnostic of parseResult.diagnostics) {
      process.stderr.write(renderTerminal(diagnostic, src, filePath) + '\n\n');
    }
    process.exit(1);
  }

  const typedProgram = parseResult.program!;
  const inputs = bindArgs(typedProgram.args, parseCliFlags(process.argv.slice(3)));

  // The program's output (its final value and any print calls) is written to
  // stdout by host.capabilities.console as it runs; the result only tells success from a crash.
  const result = await executeProgram(typedProgram, terminalHost, inputs);
  if (result.kind === 'error') {
    process.stderr.write(renderTerminal(elaborate(result.error.marker, src), src, filePath) + '\n');
    process.exit(1);
  }
};

const runRepl = async (): Promise<void> => {
  process.stdout.write(chalk.bold.green('Ascent') + ' REPL\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // The env carries the same host so `print` in a REPL line outputs here;
  // each line's own value is still echoed separately below (the '=> …'
  // inspection line), so a bare expression isn't routed through the console.
  const env = new Environment(terminalHost);
  const typeEnv = new TypeEnv(terminalHost.capabilities);

  // A while(true) loop awaiting rl.question() in turn would miss lines (and
  // the eventual close) on piped, non-TTY stdin: readline can emit 'line' —
  // even 'close' — in the gap between one question() resolving and the next
  // one re-arming its listener, and a pipe delivers fast enough to hit that
  // gap. Driving the interface as an async iterator has no such gap — it's
  // fed straight from the stream — so it's correct for both a real terminal
  // and a pipe (e.g. `echo '1 + 1;' | ascent`).
  try {
    rl.setPrompt(PROMPT);
    rl.prompt();
    for await (const line of rl) {
      const lexResult = new Lexer(line).tokenize();
      let markerIndex = 0;
      const tokenParts = lexResult.tokens
        .filter(tok => tok.kind !== 'EOF' && !isTrivia(tok.kind))
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
        const typeResult = typecheck(parseResult.program, line, terminalHost.capabilities, typeEnv);
        const typeDiagnostics = typeResult.diagnostics;

        if (typeDiagnostics.length > 0) {
          for (const diagnostic of typeDiagnostics) {
            process.stdout.write(renderTerminal(diagnostic, line, null) + '\n');
          }
        } else {
          // Print the untyped parse tree; execute the typed AST.
          // The two arrays are guaranteed to be the same length when
          // typedProgram is non-null (every statement type-checked).
          const typedStmts = typeResult.program!.stmts;
          for (let i = 0; i < typedStmts.length; i++) {
            process.stdout.write(formatTypedStmt(typedStmts[i]!) + '\n');
            try {
              const result = await executeStmt(typedStmts[i]!, env);
              process.stdout.write(chalk.dim('=> ') + formatValue(result) + '\n');
            } catch (e) {
              if (e instanceof RuntimeError) {
                process.stdout.write(renderTerminal(elaborate(e.marker, line), line, null) + '\n');
              } else {
                process.stdout.write(chalk.red(String(e)) + '\n');
              }
            }
          }
        }
      }
      rl.prompt();
    }
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
