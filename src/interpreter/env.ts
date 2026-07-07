import type { RuntimeValue } from './values.js';

// The runtime scope chain — the interpreter's twin of check/env.ts's TypeEnv.
// A self-contained store: nothing here depends on the evaluator, so the tree
// walk imports it, never the reverse.

type Binding = { value: RuntimeValue; mutable: boolean };

export type AssignResult = 'ok' | 'immutable' | 'undeclared';

// Where a program's output goes — the one external effect the tree walk can
// perform. Both a `print(...)` call and the program's final value are handed
// to it as RuntimeValues (never the "no information" value Done), so a host
// renders them however its environment demands: the CLI writes each to stdout,
// a browser playground appends it to a console panel, a test captures it into
// an array. Injecting the sink (rather than hard-wiring stdout) is what lets
// the same interpreter run in all of those places.
export type OutputSink = (value: RuntimeValue) => void;

// A chain of scopes, one per block. A lookup (or assignment) walks
// outward through parents; a declaration always writes to the current
// (innermost) scope, so a 'fix'/'mut' inside a block shadows an outer
// slot of the same name without touching it, and the shadow disappears
// once the block ends.
export class Environment {
  private readonly vars = new Map<string, Binding>();

  // The output sink rides along the scope chain rather than being a lexical
  // binding: it's set once on the root Environment and every child reaches it
  // by walking to the parent (`output` below), exactly like `get`/`assign`.
  // A null anywhere but the root means "look further out"; a null at the root
  // means no host wired up output, so it's dropped.
  public constructor(
    private readonly parent: Environment | null = null,
    private readonly sink: OutputSink | null = null,
  ) { }

  public get(name: string): RuntimeValue | undefined {
    return this.vars.get(name)?.value ?? this.parent?.get(name);
  }

  // Emit one program output value (a `print` argument, or the program's final
  // value). Walks outward to the sink established at the root — a child never
  // carries its own, so output is uniform across every scope.
  public output(value: RuntimeValue): void {
    if (this.sink !== null) { this.sink(value); return; }
    this.parent?.output(value);
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
    return new Environment(this);
  }
}
