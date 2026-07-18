import type { Host } from '../../src/host.js';

// The `testHost` column of docs/host.md's three-hosts table: a Host whose
// console capability hands each written line to the given callback instead of
// a real stream. Most tests don't care about output and just want a program
// to run cleanly, hence the no-op default.
export const testHost = (onWrite: (text: string) => void = () => { }): Host => ({
  capabilities: {
    console: { write: onWrite },
  },
});
