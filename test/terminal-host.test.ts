import assert from 'node:assert/strict';
import { terminalHost } from '../src/terminal-host.js';

// terminalHost is the `nodeHost` column of docs/host.md §5's three-hosts
// table (renamed terminalHost — see src/terminal-host.ts): the one Host
// implementation that actually touches a real terminal. Its write/writeInline
// split is what makes printInline (docs/version-0.1/stdlib/prelude.md)
// possible at all, so it's worth pinning directly against real stdout,
// separately from the language-level behaviour test/prelude.test.ts covers
// through a testHost. Only the output half is covered here — readLine blocks
// on real fd 0, which isn't safely fakeable from within the test process.
describe('terminalHost (src/terminal-host.ts)', () => {
  function captureStdout(fn: () => void): string {
    const original = process.stdout.write;
    let out = '';
    process.stdout.write = ((chunk: string) => { out += chunk; return true; }) as typeof process.stdout.write;
    try {
      fn();
    } finally {
      process.stdout.write = original;
    }
    return out;
  }

  it('write() ends the line with a trailing newline', () => {
    assert.equal(captureStdout(() => terminalHost.capabilities.console.write('hi')), 'hi\n');
  });

  it('writeInline() writes the text verbatim, with no added newline', () => {
    assert.equal(captureStdout(() => terminalHost.capabilities.console.writeInline('hi')), 'hi');
  });

  it("composes several writeInline() calls onto one line, ended by write() — prelude.md's own example", () => {
    const out = captureStdout(() => {
      terminalHost.capabilities.console.writeInline('Loading');
      terminalHost.capabilities.console.writeInline('...');
      terminalHost.capabilities.console.write('done');
    });
    assert.equal(out, 'Loading...done\n');
  });
});
