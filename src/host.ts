export interface Console {
  write(text: string): void;
}

export interface Capabilities {
  readonly console: Console;
}

export interface Host {
  readonly capabilities: Capabilities;
}
