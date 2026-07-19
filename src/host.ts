export interface Console {
  write(text: string): void;
  writeInline(text: string): void;

  // Shows `message` and resolves to ONE valid value of the type, or to null
  // if none is ultimately obtainable (a closed stdin, a cancelled dialog, …).
  // The host owns the whole interaction — validation and any re-asking
  // included: a terminal can reprint the message on bad input, while a UI
  // can hand the job to a natively-validated widget (a checkbox, a number
  // spinner) that may never need to retry at all.
  askText(message: string): Promise<string | null>;
  askInt(message: string): Promise<bigint | null>;
  askFloat(message: string): Promise<number | null>;
  askBool(message: string): Promise<boolean | null>;
}

// The outcome of a real I/O attempt, as data rather than a thrown exception
// (docs/host.md §4.2 — "failure is data"): `ok: false` carries a message, not
// a structured error type, since only 'fs.readLines' needs this today.
export type IoResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface FileSystem {
  // Reads `path` as UTF-8 text, split into lines (no trailing line
  // terminators; a file ending in a newline doesn't produce an extra empty
  // line at the end). Only what the stdlib 'fs' module's 'readLines' needs —
  // grow this the way the stdlib itself grows, one member at a time.
  readLines(path: string): Promise<IoResult<string[]>>;
}

export interface Capabilities {
  readonly console: Console;
  // Optional — real on the CLI, absent on a host with no file access. A
  // stdlib 'fs' call reaching a host without one crashes (R0014) rather than
  // failing with a raw property-access error.
  readonly fs?: FileSystem;
}

export interface Host {
  readonly capabilities: Capabilities;
}
