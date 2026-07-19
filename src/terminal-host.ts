import { readSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Host, IoResult } from './host.js';
import { askByRetrying, tryParseInt, tryParseFloat, tryParseBool } from './scalar-input.js';
import { linesOf } from './text-lines.js';

// Blocks on fd 0 one byte at a time until a line terminator or end-of-input,
// so a line's worth of stdin is consumed atomically and no byte past it is
// read ahead and lost. Returns null only when no bytes were read at all (a
// closed stdin, e.g. Ctrl+D on an empty line).
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

const write = (text: string): void => {
  process.stdout.write(text);
};

// This Host's own interaction for the ask* capabilities: reprint the message
// and read another line whenever the last one didn't parse. A different Host
// (a UI) is free to never retry at all — that choice belongs to the Host, not
// the interpreter (see docs/host.md's §9 note on this).
const ask = <T>(message: string, parse: (raw: string) => T | null): Promise<T | null> =>
  askByRetrying(write, readLineSync, message, parse);

export const terminalHost: Host = {
  capabilities: {
    console: {
      write(text: string): void {
        process.stdout.write(text + '\n');
      },
      writeInline: write,
      askText: message => ask(message, raw => raw),
      askInt: message => ask(message, tryParseInt),
      askFloat: message => ask(message, tryParseFloat),
      askBool: message => ask(message, tryParseBool),
    },
    fs: {
      async readLines(path: string): Promise<IoResult<string[]>> {
        try {
          return { ok: true, value: linesOf(await readFile(path, 'utf8')) };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
    },
  },
};
