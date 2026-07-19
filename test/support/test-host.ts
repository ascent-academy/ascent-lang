import type { Host, Capabilities, IoResult } from '../../src/host.js';
import { askByRetrying, tryParseInt, tryParseFloat, tryParseBool } from '../../src/scalar-input.js';
import { linesOf } from '../../src/text-lines.js';

// The `testHost` column of docs/host.md's three-hosts table: a Host whose
// console capability hands each written line to the given callback instead of
// a real stream. Most tests don't care about output and just want a program
// to run cleanly, hence the no-op default. `input` scripts the prompt
// family's answers, one per line read (in order); once exhausted, reading
// yields null — the same "no more input" a closed stdin gives terminalHost.
// The ask* capabilities re-ask the same way terminalHost does (write the
// message, try the next scripted line, repeat until one parses or input
// runs out) — a real UI host wouldn't retry like this, but for a test double
// standing in for a terminal, this is the right stand-in behaviour.
// `files` is an in-memory fake filesystem for the stdlib 'fs' module —
// path → content — so a test can exercise 'readLines' without touching disk.
export const testHost = (
  onWrite: (text: string) => void = () => { },
  input: readonly string[] = [],
  files: Readonly<Record<string, string>> = {},
): Host => {
  let nextInput = 0;
  const nextLine = (): string | null => (nextInput < input.length ? input[nextInput++]! : null);
  const ask = <T>(message: string, parse: (raw: string) => T | null): Promise<T | null> =>
    askByRetrying(onWrite, nextLine, message, parse);

  return {
    capabilities: {
      console: {
        write: onWrite,
        writeInline: onWrite,
        askText: message => ask(message, raw => raw),
        askInt: message => ask(message, tryParseInt),
        askFloat: message => ask(message, tryParseFloat),
        askBool: message => ask(message, tryParseBool),
      },
      fs: {
        async readLines(path: string): Promise<IoResult<string[]>> {
          const content = files[path];
          if (content === undefined) return { ok: false, error: `no such file: ${path}` };
          return { ok: true, value: linesOf(content) };
        },
      },
    },
  };
};

// A representative capability set for parse()/typecheck()'s now-required
// capabilities argument. Every test host in this suite has the same shape
// (console + fs) regardless of its onWrite/input/files behaviour, so one
// shared instance suffices for typecheck-time gating (N0018) across the whole
// test suite; a test that specifically wants a *restricted* set (no fs) builds
// its own `{ console: ... }`-shaped object instead.
export const testCapabilities: Capabilities = testHost().capabilities;
