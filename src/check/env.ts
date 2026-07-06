import type { Span } from '../lexer/token.js';
import type { AscentType } from '../types/types.js';

// origin records how the name was created — 'fix'/'mut' declarations, or a
// program 'arg' input — so the three reassignment mistakes get distinct errors.
// declSpan is where a fix/mut name was created (so errors can point back at it);
// it is null for names with no source location (program args).
export interface Binding {
  ty: AscentType;
  origin: 'fix' | 'mut' | 'arg';
  declSpan: Span | null;
}

// A chain of scopes mirroring Environment in the interpreter.
export class TypeEnv {
  private vars = new Map<string, Binding>();
  public constructor(private readonly parent: TypeEnv | null = null) { }

  public get(name: string): Binding | null {
    return this.vars.get(name) ?? this.parent?.get(name) ?? null;
  }

  public set(name: string, ty: AscentType, origin: Binding['origin'], declSpan: Span | null = null): void {
    this.vars.set(name, { ty, origin, declSpan });
  }

  public child(): TypeEnv {
    return new TypeEnv(this);
  }

  // The bindings declared directly in this scope (not inherited from a
  // parent) — used to promote a successful trial scope's new names into
  // a persistent parent, e.g. across REPL lines.
  public ownEntries(): IterableIterator<[string, Binding]> {
    return this.vars.entries();
  }
}
