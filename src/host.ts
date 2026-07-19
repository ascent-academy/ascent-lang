export interface Console {
  write(text: string): void;
  writeInline(text: string): void;
  readLine(): string | null;
}

export interface Capabilities {
  readonly console: Console;
}

export interface Host {
  readonly capabilities: Capabilities;
}
