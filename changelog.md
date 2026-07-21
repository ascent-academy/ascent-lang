# Ascent 0.20.0 (unreleased)

Changes since `v0.19.0` (`0.19.0` → `0.20.0`). This release is dominated by two things: the interpreter becoming genuinely asynchronous, and a `Host`/`Capabilities` abstraction replacing the old output-only sink — both driven by adding real I/O (file reads, console prompts) to the standard library. If you embed `@ascent-lang/dev` as a library, read the **Migration checklist** at the bottom first.

## Breaking changes

### Embedder API (`src/lib.ts`)

- **The interpreter is now async.** `evaluateExpr`, `executeStmt`, and `executeProgram` all return `Promise`s now, backed by real `await` internally (no more bespoke scheduler). Every call site must `await` them.
- **`OutputSink` is gone, replaced by `Host`.** The old `{ stdout(text) }` sink only supported writing. The new `Host` (`src/host.ts`) exposes a `capabilities` object — currently `console` (write/writeInline plus async `askText`/`askInt`/`askFloat`/`askBool`) and an optional `fs` (`readLines`). A reference terminal implementation is exported as `terminalHost` (`src/terminal-host.ts`).
- **`parse()` and `typecheck()` now require a `Capabilities` argument:**
  ```ts
  // before
  const { program, diagnostics } = parse(src);
  // now
  const { program, diagnostics } = parse(src, host.capabilities);
  ```
  This is what lets an import the target environment can't actually satisfy (e.g. `fs` with no real filesystem) get rejected at check time (`N0018`) instead of crashing mid-run.
- **`Environment`'s constructor signature flipped and now takes a `Host`:**
  ```ts
  // before
  new Environment(parent, sink)
  // now
  new Environment(host, parent?)
  ```
- **`executeProgram(program, host, inputs?)`** — second parameter is now a `Host`, not a sink, and the call must be awaited.

### Language surface

- **Function bodies must now start with `=>`.** A bare block body, `fn(...): T { ... }`, is a syntax error (`S0026`). The two valid forms are:
  ```
  fn(x: Int): Int => x + 1
  fn(x: Int): Int => { fix y = x + 1; y * 2 }
  ```
  (`S0027`, which used to flag a redundant `=> { }`, is retired — `=> { }` is now the required block form, not a duplicate.)
- **`Float.toInt()` removed.** Replaced by four explicit rounding methods — `.trunc()`, `.round()`, `.floor()`, `.ceil()` — all `Float -> Int`, so the rounding direction is never implicit.
- **`String.slice()` signature changed back to two `Int`s:** `s.slice(from, to)` (half-open, grapheme indices), not a `Range`. An interim `Range`-based signature is reverted.

## New features

### Standard library

- **`Bool.toString()`** added.
- **`String` module fleshed out** with: `isEmpty`, `drop`, `take`, `contains`, `startsWith`, `endsWith`, `toUpper`, `toLower`, `toTitle`, `trimStart`, `trimEnd`, `padRight`, `split`, `lines`, `codePoints`, `bytes`, plus fallible `toInt`/`toFloat`/`toBool` — each returns `T?` (`None` on unparsable input) rather than crashing.
- **New `fs` stdlib module** — `import { readLines } from "fs"`. It's async, so it's called as `await readLines!(path)`, and returns `Result<List<String>, String>` (a missing/unreadable file is a `Failure`, not a crash). Requires a `Host` with the `fs` capability; without one, it's rejected at check time (`N0018`) if declared unavailable, or crashes with `R0014` if the capability is simply absent from the running host.
- **New ambient `prelude`** (no import needed): `print`, `printInline`, and the async `prompt` / `promptInt` / `promptFloat` / `promptBool` family for console I/O — call as `await prompt!("Name? ")`.

### Language mechanics

- **Top-level `try` is now supported** (previously only legal inside a function). A `Failure`/`None` propagating out of a top-level `try` stops the program with a new runtime error instead of being rejected by the checker: `R0015` (Result) / `R0016` (Optional).
- **Capability-gated imports.** `parse()`/`typecheck()` take a `Capabilities` value describing what the eventual host supports; importing a module needing a capability the caller didn't declare is `N0018`.
- **`N0017`** — calling a built-in async function (e.g. `prompt`) without preparing it with `!` and `await` is now its own diagnostic, mirroring the existing rule for user-defined `async fn`.

### Tooling

- Initial VS Code extension scaffold under `editors/vscode/` (TextMate grammar + language configuration) for `.asc` syntax highlighting.

## Bug fixes

- REPL no longer drops lines (or the trailing EOF) when stdin is piped instead of an interactive terminal (e.g. `echo '1 + 1;' | ascent`).
- Fixed free-variable capture for `return` expressions inside closures.
- Lexer's keyword/constructor lookup switched from plain objects to `Map`, fixing identifiers that collided with `Object.prototype` member names (e.g. a variable or field literally named `toString`).

## Documentation

- The whitepaper moved to `docs/version-0.1/ascent-v0.1-whitepaper.md`, alongside new stdlib reference docs: `docs/version-0.1/stdlib/prelude.md`, `scalars.md`, `string.md`.
- `docs/host.md` expanded to document the `Host` / `Capabilities` / `Console` / `FileSystem` contract for embedders.

---

## Migration checklist (embedders using `@ascent-lang/dev` as a library)

1. Obtain a `Host` — use `terminalHost` (`src/terminal-host.ts`) for CLI-like usage, or implement your own against the `Host`/`Capabilities`/`Console`/`FileSystem` interfaces in `src/host.ts`.
2. Pass `host.capabilities` as the second argument to `parse()` (and to `typecheck()` if calling it directly).
3. Pass `host` — not a sink — to `new Environment(...)` and `executeProgram(...)`.
4. `await` every call to `evaluateExpr`, `executeStmt`, and `executeProgram` — they're all `Promise`-returning now.
5. Update any `.asc` source using bare `{ }` function bodies to `=> { }` (or `=> expr`).
6. Replace any `Float.toInt()` calls with `.trunc()`, `.round()`, `.floor()`, or `.ceil()` depending on the rounding behavior you want.
7. Update any `String.slice(range)` calls to the two-argument `String.slice(from, to)`.
