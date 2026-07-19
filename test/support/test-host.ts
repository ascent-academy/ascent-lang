import type { Host } from '../../src/host.js';

// The `testHost` column of docs/host.md's three-hosts table: a Host whose
// console capability hands each written line to the given callback instead of
// a real stream. Most tests don't care about output and just want a program
// to run cleanly, hence the no-op default. `input` scripts the prompt family's
// answers (one per readLine call, in order); once exhausted, readLine returns
// null — the same "no more input" a closed stdin gives the real terminalHost.
export const testHost = (
  onWrite: (text: string) => void = () => { },
  input: readonly string[] = [],
): Host => {
  let nextInput = 0;
  return {
    capabilities: {
      console: {
        write: onWrite,
        writeInline: onWrite,
        readLine: () => (nextInput < input.length ? input[nextInput++]! : null),
      },
    },
  };
};
