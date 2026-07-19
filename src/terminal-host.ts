import { readSync } from 'node:fs';
import type { Host } from './host.js';

// Blocks on fd 0 one byte at a time until a line terminator or end-of-input,
// so a line's worth of stdin is consumed atomically and no byte past it is
// read ahead and lost (a `!` prelude prompt has no event loop to hand a
// callback to — the interpreter runs `await` synchronously, docs/host.md §8's
// open decision). Returns null only when no bytes were read at all (a closed
// stdin, e.g. Ctrl+D on an empty line).
const readLineSync = (): string | null => {
  const byte = Buffer.alloc(1);
  const bytes: number[] = [];
  while (true) {
    let n: number;
    try {
      n = readSync(0, byte, 0, 1, null);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EAGAIN') {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        continue;
      }
      throw e;
    }
    if (n === 0) return bytes.length > 0 ? Buffer.from(bytes).toString('utf8') : null;
    if (byte[0] === 10) break; // '\n'
    bytes.push(byte[0]!);
  }
  if (bytes.length > 0 && bytes[bytes.length - 1] === 13) bytes.pop(); // a trailing '\r' (CRLF)
  return Buffer.from(bytes).toString('utf8');
};

export const terminalHost: Host = {
  capabilities: {
    console: {
      write(text: string): void {
        process.stdout.write(text + '\n');
      },
      writeInline(text: string): void {
        process.stdout.write(text);
      },
      readLine: readLineSync,
    },
  },
};
