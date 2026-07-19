import { isInt64 } from './interpreter/arithmetic.js';

// What counts as a valid Int/Float/Bool typed at a prompt — "same validation"
// as `program`'s own boundary (docs/version-0.1/stdlib/prelude.md), mirroring
// the CLI's --flag parsing in src/index.ts's bindArgs. Each returns null on
// bad input rather than raising an error, since a prompt re-asks instead of
// failing outright — kept here, not duplicated, so `terminalHost` and
// `testHost` (test/support/test-host.ts) apply the identical rule.
export const tryParseInt = (raw: string): bigint | null => {
  if (!/^-?\d+$/.test(raw)) return null;
  const parsed = BigInt(raw);
  return isInt64(parsed) ? parsed : null;
};

export const tryParseFloat = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isNaN(n) || !Number.isFinite(n) ? null : n;
};

export const tryParseBool = (raw: string): boolean | null =>
  raw === 'true' ? true : raw === 'false' ? false : null;

// The "write the message, read a line, retry until `parse` accepts it, give
// up (null) once there's nothing left to read" loop — the interaction a
// terminal-like Host wants for its ask* capabilities. Not part of the Host
// contract itself: a UI host would implement askInt/askBool with its own
// natively-validated widget instead, never calling this.
export const askByRetrying = async <T>(
  write: (text: string) => void,
  readLine: () => string | null,
  message: string,
  parse: (raw: string) => T | null,
): Promise<T | null> => {
  while (true) {
    write(message);
    const raw = readLine();
    if (raw === null) return null;
    const parsed = parse(raw);
    if (parsed !== null) return parsed;
  }
};
