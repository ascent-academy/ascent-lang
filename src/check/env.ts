import type { Span } from '../lexer/token.js';
import type { AscentType } from '../types/types.js';
import type { Capabilities } from '../host.js';

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
// (the 'type X = { … }' sugar, design.md §6); a tagged union has several, each
// with its own tag and fields (whitepaper §6). declSpan points at the type name
// in its declaration (for a "already declared here" related span).
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
  // Stdlib imports (whitepaper §10), kept in their own two namespaces so they
  // never collide with value slots or type names. `importedFns` maps a named
  // import ('min') to the module it came from ('math'); `namespaces` maps a
  // namespace import binding ('math') to that module. Both resolve against the
  // compiler-known registry (check/stdlib.ts) — the value is just the module
  // name, since the export's signature lives there.
  private importedFns = new Map<string, string>();
  private namespaces = new Map<string, string>();
  // The declared return type of the nearest enclosing function, if any — set
  // only on the scope a function body runs in (childForFunction), null
  // everywhere else. A 'return' looks it up via enclosingReturn() to check its
  // value against it, and a 'return' with none in scope is outside any function.
  // The async color of the nearest enclosing function (whitepaper §8) — set on
  // the scope a function body runs in (childForFunction). At the root it is
  // undefined, and enclosingAsync() treats that as *async*: the program body and
  // each REPL line are the root async context, so top-level 'await' is allowed.
  //
  // `capabilities` is the Host capability set this program is being checked
  // against (docs/host.md §6/§9) — required (never a silent default) at every
  // call site, `null` everywhere except the root: a fresh scope's `child()`/
  // `childForFunction()` always pass `null` and let `getCapabilities()` walk up
  // to the root that actually carries it, exactly like `funcReturn`/`funcAsync`.
  public constructor(
    private readonly capabilities: Capabilities | null,
    private readonly parent: TypeEnv | null = null,
    private readonly funcReturn: AscentType | null = null,
    private readonly funcAsync: boolean | null = null,
  ) { }

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

  // The module a bare imported name ('min') came from, or null — walked outward
  // like every other lookup. Used by the 'call' judgment to route 'min(…)' to
  // the stdlib registry instead of a user slot.
  public getImportedFn(name: string): string | null {
    return this.importedFns.get(name) ?? this.parent?.getImportedFn(name) ?? null;
  }

  public setImportedFn(name: string, module: string): void {
    this.importedFns.set(name, module);
  }

  // The module a namespace binding ('math') stands for, or null. Used by the
  // 'methodCall' judgment to resolve 'math.min(…)' as a module export.
  public getNamespace(name: string): string | null {
    return this.namespaces.get(name) ?? this.parent?.getNamespace(name) ?? null;
  }

  public setNamespace(name: string, module: string): void {
    this.namespaces.set(name, module);
  }

  // Resolve a constructor tag ('Circle') to the type it builds and the variant
  // it names. Unlike getType (keyed by the *type* name), this searches each
  // type's variants — a single-variant record's tag equals its type name, but a
  // union's variant tags ('Circle', 'Square') differ from the type ('Shape').
  // The checker keeps tags unambiguous (N0010), so the first match is the only
  // match; a child scope still shadows a parent, as with every other lookup.
  public getConstructor(tag: string): { info: TypeInfo; variant: Variant } | null {
    for (const info of this.types.values()) {
      const variant = info.variants.find(v => v.tag === tag);
      if (variant !== undefined) return { info, variant };
    }
    return this.parent?.getConstructor(tag) ?? null;
  }

  public child(): TypeEnv {
    return new TypeEnv(null, this);
  }

  // The scope a function body is checked in: a child that also records the
  // function's declared return type, so a 'return' anywhere inside resolves it
  // (a nested function overrides it with its own). Separate from child() so only
  // a real function boundary establishes a return target.
  public childForFunction(returnType: AscentType, async = false): TypeEnv {
    return new TypeEnv(null, this, returnType, async);
  }

  // The declared return type of the nearest enclosing function, or null when not
  // inside one (a 'return' there is out of place — T0043).
  public enclosingReturn(): AscentType | null {
    return this.funcReturn ?? this.parent?.enclosingReturn() ?? null;
  }

  // Whether the nearest enclosing function is async — i.e. whether 'await' is
  // legal here (whitepaper §8's colored model). A childForFunction scope pins
  // this to that function's color; a plain child() inherits by walking up. At
  // the root (no enclosing function) it is *true*: the program body and each
  // REPL line are the root async context, so top-level 'await' works.
  public enclosingAsync(): boolean {
    return this.funcAsync ?? this.parent?.enclosingAsync() ?? true;
  }

  // The Host capability set this program is being checked against — used only
  // by the 'import' statement judgment (stmt.ts), to reject a module whose
  // required capability isn't present (N0018). Unlike enclosingReturn/Async,
  // there is no sensible default to fall back to at the root: every root is
  // required to carry a real one (typecheck()'s own required parameter), so
  // reaching a root with none is an internal invariant violation, not a
  // legitimate "no restriction" case.
  public getCapabilities(): Capabilities {
    if (this.capabilities !== null) return this.capabilities;
    if (this.parent === null) throw new Error('internal: TypeEnv root constructed with no capabilities');
    return this.parent.getCapabilities();
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

  // The same, for imports — so an 'import' on one REPL line keeps its names in
  // scope on the next, alongside the line's new slots and types.
  public ownImportedFns(): IterableIterator<[string, string]> {
    return this.importedFns.entries();
  }

  public ownNamespaces(): IterableIterator<[string, string]> {
    return this.namespaces.entries();
  }
}
