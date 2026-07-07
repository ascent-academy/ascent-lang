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

// One declared field of a record: its name and the AscentType its declared
// TypeExpr formed into. `span` is the field's own span in source, so a
// per-field diagnostic (a construction type mismatch) can point back at where
// the field was declared.
export interface RecordField {
  name: string;
  type: AscentType;
  span: Span;
}

// The structure behind a nominal 'Named' type — the registry entry a type name
// resolves to. A record is a single variant whose tag equals the type name
// (the 'type X = { … }' sugar, design.md §6); modelling it as a variant list
// now is what lets tagged unions be "more than one variant" later, with no
// re-representation. declSpan points at the type name in its declaration (for a
// "already declared here" related span).
export interface Variant {
  tag: string;
  fields: RecordField[];
}
export interface TypeInfo {
  name: string;
  variants: Variant[];
  declSpan: Span;
}

// A chain of scopes mirroring Environment in the interpreter. It carries two
// parallel namespaces — value bindings (lowercase slots) and type declarations
// (UpperCamel names) — that never collide, since the casing rule keeps the two
// kinds of name apart (design.md §2).
export class TypeEnv {
  private vars = new Map<string, Binding>();
  private types = new Map<string, TypeInfo>();
  public constructor(private readonly parent: TypeEnv | null = null) { }

  public get(name: string): Binding | null {
    return this.vars.get(name) ?? this.parent?.get(name) ?? null;
  }

  public set(name: string, ty: AscentType, origin: Binding['origin'], declSpan: Span | null = null): void {
    this.vars.set(name, { ty, origin, declSpan });
  }

  public getType(name: string): TypeInfo | null {
    return this.types.get(name) ?? this.parent?.getType(name) ?? null;
  }

  public setType(info: TypeInfo): void {
    this.types.set(info.name, info);
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

  // The same, for type declarations — so a REPL line's new types persist into
  // later lines alongside its new slots.
  public ownTypeEntries(): IterableIterator<[string, TypeInfo]> {
    return this.types.entries();
  }
}
