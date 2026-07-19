import { Host, type FileSystem } from '../host.js';
import type { RuntimeValue } from './values.js';

// The runtime scope chain — the interpreter's twin of check/env.ts's TypeEnv.
// A self-contained store: nothing here depends on the evaluator, so the tree
// walk imports it, never the reverse.

type Binding = { value: RuntimeValue; mutable: boolean };

export type AssignResult = 'ok' | 'immutable' | 'undeclared';

// A chain of scopes, one per block. A lookup (or assignment) walks
// outward through parents; a declaration always writes to the current
// (innermost) scope, so a 'fix'/'mut' inside a block shadows an outer
// slot of the same name without touching it, and the shadow disappears
// once the block ends.
export class Environment {
  private readonly vars = new Map<string, Binding>();

  // The host is threaded through every child/snapshot Environment (rather than
  // looked up via the parent chain like `get`/`assign`), so `output` below can
  // always reach it directly without walking outward.
  public constructor(
    private readonly host: Host,
    private readonly parent: Environment | null = null,
  ) { }

  public get(name: string): RuntimeValue | undefined {
    return this.vars.get(name)?.value ?? this.parent?.get(name);
  }

  // The binding for `name` (value + mutability) from whichever scope owns it, or
  // undefined if unbound. Used by snapshot() to copy a captured slot faithfully.
  private lookup(name: string): Binding | undefined {
    return this.vars.get(name) ?? this.parent?.lookup(name);
  }

  // A by-value snapshot of `names` as a fresh, parent-less scope — the closure
  // environment for a function value (capture-by-value, whitepaper §5). Each
  // captured binding's value *and* mutability are copied, so the closure holds
  // its own independent slots; later changes to the outer slots are invisible to
  // it. The host is carried across so output from the function body still lands.
  // A name with no binding yet (the recursive self-name, tied in afterward) is
  // simply skipped.
  public snapshot(names: string[]): Environment {
    const snap = new Environment(this.host, null);
    for (const name of names) {
      const binding = this.lookup(name);
      if (binding !== undefined) snap.vars.set(name, { value: binding.value, mutable: binding.mutable });
    }
    return snap;
  }

  // Emit one line of already-formatted program output.
  public output(text: string): void {
    this.host.capabilities.console.write(text);
  }

  // Emit text with no line break — printInline (docs/version-0.1/stdlib/prelude.md).
  public outputInline(text: string): void {
    this.host.capabilities.console.writeInline(text);
  }

  // Show `message` and gather one valid value of the type — the prompt
  // family's read half. Null means none was ultimately obtainable (host-
  // specific: a closed stdin, a cancelled dialog, …); the host owns whatever
  // interaction (retries included) got it there, never the interpreter.
  public askText(message: string): Promise<string | null> {
    return this.host.capabilities.console.askText(message);
  }

  public askInt(message: string): Promise<bigint | null> {
    return this.host.capabilities.console.askInt(message);
  }

  public askFloat(message: string): Promise<number | null> {
    return this.host.capabilities.console.askFloat(message);
  }

  public askBool(message: string): Promise<boolean | null> {
    return this.host.capabilities.console.askBool(message);
  }

  // The fs capability, if this host provides one — undefined otherwise, which
  // an async stdlib 'fs' call turns into a clean crash (R0014) rather than a
  // raw property-access error on a missing capability.
  public fs(): FileSystem | undefined {
    return this.host.capabilities.fs;
  }

  public declare(name: string, value: RuntimeValue, mutable: boolean): void {
    this.vars.set(name, { value, mutable });
  }

  // Reassigns a slot in whichever scope actually owns it (not
  // necessarily this one), mutating the binding in place so every
  // Environment sharing this chain sees the new value immediately —
  // this is what lets a 'while' loop's condition observe a slot its
  // body just changed.
  public assign(name: string, value: RuntimeValue): AssignResult {
    const binding = this.vars.get(name);
    if (binding === undefined) {
      return this.parent?.assign(name, value) ?? 'undeclared';
    }
    if (!binding.mutable) return 'immutable';
    binding.value = value;
    return 'ok';
  }

  public child(): Environment {
    return new Environment(this.host, this);
  }
}
