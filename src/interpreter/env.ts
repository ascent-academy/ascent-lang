import type { RuntimeValue } from './values.js';

// The runtime scope chain — the interpreter's twin of check/env.ts's TypeEnv.
// A self-contained store: nothing here depends on the evaluator, so the tree
// walk imports it, never the reverse.

type Binding = { value: RuntimeValue; mutable: boolean };

export type AssignResult = 'ok' | 'immutable' | 'undeclared';

// Where a program's output goes — the one external effect the tree walk can
// perform. Ascent formats every value to its display string itself (so the
// language, not the host, decides how a List or a Float looks); the sink only
// ever receives finished text. A host just decides where that text lands: the
// CLI writes each line to stdout, a browser playground appends it to a console
// panel, a test captures it into an array. Injecting the sink (rather than
// hard-wiring stdout) is what lets the same interpreter run in all of those
// places. It's an interface, not a bare function, so more streams (e.g. a
// separate stderr) can be added later without changing the shape everywhere.
export interface OutputSink {
  stdout(text: string): void;
}

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

  // The binding for `name` (value + mutability) from whichever scope owns it, or
  // undefined if unbound. Used by snapshot() to copy a captured slot faithfully.
  private lookup(name: string): Binding | undefined {
    return this.vars.get(name) ?? this.parent?.lookup(name);
  }

  // The output sink in effect for this chain — walked to the root, where a host
  // wired one up. A closure snapshot (parent-less) needs it so a 'print' inside
  // a function body still reaches output.
  private effectiveSink(): OutputSink | null {
    return this.sink ?? this.parent?.effectiveSink() ?? null;
  }

  // A by-value snapshot of `names` as a fresh, parent-less scope — the closure
  // environment for a function value (capture-by-value, whitepaper §5). Each
  // captured binding's value *and* mutability are copied, so the closure holds
  // its own independent slots; later changes to the outer slots are invisible to
  // it. The sink is carried across so output from the function body still lands.
  // A name with no binding yet (the recursive self-name, tied in afterward) is
  // simply skipped.
  public snapshot(names: string[]): Environment {
    const snap = new Environment(null, this.effectiveSink());
    for (const name of names) {
      const binding = this.lookup(name);
      if (binding !== undefined) snap.vars.set(name, { value: binding.value, mutable: binding.mutable });
    }
    return snap;
  }

  // Emit one line of already-formatted program output (a `print` argument, or
  // the program's final value, rendered to text by the caller). Walks outward
  // to the sink established at the root — a child never carries its own, so
  // output is uniform across every scope.
  public output(text: string): void {
    if (this.sink !== null) { this.sink.stdout(text); return; }
    this.parent?.output(text);
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
