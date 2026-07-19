# Ascent — The Host · the capability boundary

> **Design note (proposal — not yet built).** Companion to the whitepaper,
> chiefly §8 (async), §9 (errors-as-data), §11 (the environment & effects-as-data),
> and §12 (VM, fuel). This shapes the boundary between the *pure interpreter* and
> the *impure outside world* — generalizing today's lone `OutputSink` into one
> injected **`Host`**. The point: the same interpreter has to run in a terminal, in
> a browser teaching platform, and under a deterministic test — three very different
> outside worlds — without the interpreter ever naming a `node:`/browser API.

---

## 1. The problem, and the name

The interpreter already has *one* thread of "the outside world": the `OutputSink`
(`{ stdout(text) }`) an embedder passes to `executeProgram`, reached through the
scope chain as `env.output(text)`. That is the seam this note widens. A real
program will also want to read files, make network requests, ask the time, draw a
random number — and be *debugged*, *paused*, and *bounded*. All of that is the
same seam.

**The concept is the *host*, and what it provides are *capabilities*.** The design
principle is **capability-based (object-capability, "ocap")**: a program has *no
ambient authority* — it can only touch the world through capabilities the host
explicitly hands it. In PL-theory terms the identical idea is **effects/abilities
with handlers**.

Naming, deliberately:

- **`Host`** for the injected bundle. It is what V8, Wasm, and Lua all call the
  embedder. `OutputSink` is already a single-capability *handle* in the Haskell
  "handle pattern" sense; the Host is the record of handles.
- **Not `Runtime`** — the whitepaper already uses "runtime" for the impure loop
  that performs `Command`s (§11). Keep that word for that layer (see §2).
- **Not `Context`** — although Effect-TS's service registry is a `Context` and Go
  has `context.Context`, that word connotes *cancellation / request scope*, which
  here is only *one* of the host's three concerns (§4.3). Too narrow, and it
  collides with the interpreter's own `Environment` (the scope chain).

## 2. The three-layer model

The whitepaper (§11) already draws the top of this: user code is pure and
*returns `Command` values describing effects*; "the runtime loop is the single
impure component — written once, in the stdlib." The Host is the layer *beneath*
that runtime — the primitive capabilities it calls to actually do the I/O.

```
Program   (pure Ascent)     — returns Command values, awaits Tasks; touches nothing real
   │
Runtime   (impure, stdlib)  — interprets Commands, drives await; the one impure loop (§11)
   │
Host      (injected)        — primitive capabilities: console, clock, random, fs, net
   ▲                          THIS is what differs: terminal vs platform vs test
   └── provided by the embedder
```

So the thing this note designs is the bottom layer. `OutputSink` is the Host with
exactly one capability (`console`) filled in. A `Command.fetch(url)` value, when
the §11 runtime lands, is performed by the runtime calling
`host.capabilities.net.fetch(url)` and feeding the result back as a message —
i.e. the Host underlies both the script path and the future UI path.

## 3. Prior art to lean on

- **WASI (WebAssembly System Interface)** — the closest match to Ascent's exact
  situation: a portable, sandboxed guest that runs in a browser *and* natively,
  where each host implements a **curated** capability set (`fd_read`,
  `clock_time_get`, …) and simply *omits* what it can't offer. Read it as the
  reference model.
- **Deno** — the same idea from the security angle: sandboxed by default,
  capabilities granted explicitly (`--allow-net`). This is what "the program can
  only do what it was handed" looks like as a product.
- **The handle pattern (Haskell)** — a record of functions injected per effect.
  `OutputSink` is already one handle.
- **The Elm Architecture / effects-as-data** — the whitepaper's own §11 model, of
  which the Host is the substrate.

## 4. The design

### 4.1 One `Host`, three directions

The word "context" hides three genuinely different relationships. Keeping them as
separate members is what stops `Host` from decaying into a junk drawer:

```ts
// src/host/host.ts  (proposed)
export interface Host {
  readonly capabilities: Capabilities;  // program → host    (effects the program requests)
  readonly limits?: Limits;             // host → interpreter (resource governance)
  readonly tracer?: Tracer;             // interpreter → host (observability / debug)
}
```

`executeProgram(program, host, inputs)` replaces today's
`executeProgram(program, outputSink, inputs)`.

### 4.2 Capabilities — the effect surface (program → host)

Small, curated interfaces — the same closed-and-curated philosophy as the stdlib
and the DSL tag set, **not** a mirror of the OS syscall surface. Optional, because
*the host decides which exist* (§6). Fallible and async exactly where the real
world is (§8/§9).

```ts
export interface Capabilities {
  readonly console: Console;   // always present — backs the `print` prelude
  readonly clock?: Clock;      // the ONLY source of "now"
  readonly random?: Random;    // the ONLY source of randomness
  readonly fs?: FileSystem;    // real on the CLI, virtual on the platform, absent on a bare host
  readonly net?: Network;      // sandboxed/proxied on the platform
  // grows one curated capability at a time, like the stdlib
}

export interface Console {
  write(text: string): void;                        // exactly today's OutputSink.stdout
}

export interface Clock {
  now(): bigint;                                    // epoch millis, as an Ascent Int
  monotonic(): bigint;                              // for durations; immune to clock changes
}

export interface Random {
  next(): number;                                   // uniform [0,1); a seeded impl → replayable
}

export interface FileSystem {                       // async + fallible: I/O is both
  read(path: string): Promise<Result<string, IoError>>;
  write(path: string, data: string): Promise<Result<Done, IoError>>;
  exists(path: string): Promise<boolean>;
}

export interface Network {
  fetch(req: HttpRequest): Promise<Result<HttpResponse, NetError>>;
}
```

Two things are baked into these signatures on purpose:

- **fs/net return `Result<…>` and `Promise<…>`.** Failure is *data* (§9); timing
  is `await` (§8). They drop straight into the `Task`/`await` machinery and, later,
  into the §11 Command-runtime.
- **`clock` and `random` are the only non-determinism.** The interpreter must
  never call `Date.now()` / `Math.random()`. See §7 — this one rule is what buys
  replay and time-travel.

### 4.3 Governance — resource limits (host → interpreter)

The host bounding the interpreter, not the program asking for anything:

```ts
export interface Limits {
  readonly fuel?: number;         // max evaluation steps → a friendly "too much work" stop (§12).
                                  // This is also the clean fix for the recursion-crash defect
                                  // (deep recursion currently dies with a raw RangeError).
  readonly signal?: AbortSignal;  // host-driven cancellation / timeout
}
```

### 4.4 Observability — debugging (interpreter → host)

This is the **inverse** direction of a capability — the interpreter *reports to*
the host — which is exactly why it must not sit inside `Capabilities`:

```ts
export interface Tracer {
  onStep?(node: TypedExpr, env: Environment): void;   // stepping, breakpoints, time-travel capture (§12)
  onEffect?(kind: string, detail: unknown): void;     // record every capability call → replay/audit
}
```

## 5. Three hosts, one interpreter

The payoff. Every row is the same interface with a different backing:

| capability      | `terminalHost`        | `platformHost` (teaching)      | `testHost`               |
|-----------------|-----------------------|--------------------------------|--------------------------|
| `console`       | write to stdout       | append to a console panel      | collect into an array    |
| `clock`         | system clock          | injected (frozen / scrubbable) | fixed                    |
| `random`        | `Math.random`         | seeded                         | seeded                   |
| `fs`            | real `node:fs`        | **virtual, in-memory**         | recorded / fake          |
| `net`           | real `fetch`          | **sandboxed proxy**            | recorded, or absent      |
| `limits.fuel`   | none                  | generous cap                   | tight (catch runaways)   |
| `tracer`        | none                  | step inspector / time-travel   | effect recorder          |

The teaching platform's answer to *"it's not a full OS"* is right here: it
provides **virtual** implementations behind the same interfaces (in-memory fs,
proxied fetch), or omits a capability entirely. Nothing about the interpreter
changes between columns.

## 6. Partial capabilities meet the module system

Rather than a bespoke "capability absent" runtime path, tie a missing capability
to **import resolution** (§10) — honest, and it falls out of machinery that
already exists:

```ascent
import { readFile } from "fs";   # resolves only if host.capabilities.fs is present;
                                 # otherwise a clean "fs isn't available in this environment"
```

So **the host's capability set *is* the set of importable effect-modules.** Real
fs on the CLI, virtual fs on the platform, neither on a bare host — decided
entirely by which capabilities the host carries, checked where every other import
is checked.

## 7. The determinism rule

**All non-determinism flows through the Host — clock and random included.** The
interpreter core, given a Host and inputs, is otherwise a pure function of them.

This is not neatness for its own sake: it is the precondition for §11's
time-travel/replay and for reproducible tests. A `testHost` with a fixed clock, a
seeded RNG, an in-memory fs, and recorded network makes a run bit-for-bit
repeatable; the `platformHost`'s scrubbable clock is what makes the history
scrubber real. It is also the easiest rule to break by accident (one stray
`Date.now()`), so it is a rule, not a preference.

## 8. Migration from today (a tiny first step)

The first step ships **no new capability** — it only renames the injection point
and gives it room:

1. `OutputSink { stdout }` → `Console { write }`; add `Host.capabilities.console`.
2. `Environment` carries `host` instead of `sink`; `env.output(text)` becomes
   `env.host.capabilities.console.write(text)`.
3. `executeProgram(program, host, inputs)`; the CLI builds a `terminalHost`, the
   test harness a `testHost`.

Everything after that (clock, random, fs, net, limits, tracer) is added one
curated capability at a time, exactly the way the stdlib grows.

## 9. Open decisions

- **Reach path.** Do *scripts* get effects via `import … from "fs"` (capabilities
  surfaced as modules), via the §11 `Command` runtime, or both? Current lean:
  imports→capabilities for scripts, `Command`s for UI, the Host underneath both.
- **`clock` / `random`: optional vs always-on.** Optional permits a *fully*
  timeless, deterministic host; always-on is simpler for authors.
- **Fuel granularity.** Per-node step, per-call, or per-loop-iteration — trades
  overhead against how tightly a runaway is caught.
- **Async today.** v1 runs `await` synchronously (§8), yet fs/net are shaped
  `Promise<…>` so the interfaces don't churn when a real scheduler lands. Confirm
  the interpreter can drive a synchronous-resolution Promise cleanly in the
  meantime.
