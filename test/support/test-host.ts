import type { Host } from '../../src/host.js';
import { askByRetrying, tryParseInt, tryParseFloat, tryParseBool } from '../../src/scalar-input.js';

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
export const testHost = (
  onWrite: (text: string) => void = () => { },
  input: readonly string[] = [],
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
    },
  };
};
