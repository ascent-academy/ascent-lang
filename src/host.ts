// docs/host.md §8 step 1: OutputSink renamed into the console capability of a
// Host. `clock`/`random`/`fs`/`net`/`limits`/`tracer` land later, one at a time.
export interface Console {
  write(text: string): void;
}

export interface Capabilities {
  readonly console: Console;
}

export interface Host {
  readonly capabilities: Capabilities;
}
