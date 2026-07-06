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

  public constructor(private readonly parent: Environment | null = null) { }

  public get(name: string): RuntimeValue | undefined {
    return this.vars.get(name)?.value ?? this.parent?.get(name);
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
