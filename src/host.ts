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

export interface Capabilities {
  readonly console: Console;
}

export interface Host {
  readonly capabilities: Capabilities;
}
