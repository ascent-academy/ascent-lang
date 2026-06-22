// errors.ts — the append-only registry of every Ascent diagnostic code.
//
// THE CONTRACT
//   * A code is a permanent NAME, allocated once when an error is born.
//   * Allocate the next free number IN ITS CATEGORY (each letter has its own
//     counter). Numbers are assigned over time, never by code layout — so the
//     compiler can be reorganised freely without a code ever moving.
//   * Never reuse a number. To remove an error, set `retired: true`; never
//     delete the row and never recycle its number.
//   * Compiler code references the symbolic `name` (e.g. "assign-to-fixed-slot"),
//     never the raw code string, so the integer lives in exactly one place: here.
//   * The docs URL is derived, not stored: `${DOCS_BASE}/errors/${code}`.
//
// CLASSIFY BY NATURE, NOT BY WHERE IT IS CAUGHT.
//   The category is the KIND of mistake, not the stage that happens to detect it
//   today. Ascent is dynamic-first: in Stage 1 the type errors below (T*) fire at
//   RUNTIME, because there is no static checker yet — but their nature is *type*,
//   so they are T codes, and when the checker lands in Stage 6 the SAME codes
//   simply fire earlier. Conversely, a literal `1 div 0` folded at compile time
//   is still R0001 — its nature is "a value was zero." Detection-site moves; the
//   code never does.
//
//   Boundary guidance: assign-to-fixed-slot and undefined-name are N (about the
//   NAME / slot), not T. Non-exhaustive match and wrong arity (later) are T
//   (about the TYPE).

import type { Category } from "./diagnostic";

export interface RegistryEntry {
  /** Stable, doc-referenceable, e.g. "T0001". First letter = category. */
  code: string;
  /** Symbolic name referenced throughout the compiler. */
  name: string;
  category: Category;
  /** One line for the registry / docs index (the user-facing headline lives on
   *  the Diagnostic, not here). */
  summary: string;
  /** Set instead of deleting; the number is never reused. */
  retired?: boolean;
}

export const REGISTRY: RegistryEntry[] = [
  // ── L · Lexical — the characters don't form a valid token ─────────────────
  { code: "L0001", name: "unexpected-character", category: "lexical", summary: "A character that can't begin any token." },
  { code: "L0002", name: "malformed-number", category: "lexical", summary: "A number written like `.5` (no digit before the point) or run into letters like `123abc`." },
  { code: "L0003", name: "unterminated-block-comment", category: "lexical", summary: "A `#[` block comment with no closing `]#`." },
  { code: "L0004", name: "invalid-escape-sequence", category: "lexical", summary: "A `\\x` escape in a string that isn't one of \\\" \\\\ \\n \\t \\r." },
  { code: "L0005", name: "unterminated-string", category: "lexical", summary: "A string opened with \" that reaches end of file with no closing \"." },

  // ── S · Syntax — the tokens don't form valid grammar ──────────────────────
  { code: "S0001", name: "unexpected-token", category: "syntax", summary: "A token that can't appear in this position." },
  { code: "S0002", name: "expected-expression", category: "syntax", summary: "An expression was required here (e.g. after `=` or `(`)." },
  { code: "S0003", name: "expected-semicolon", category: "syntax", summary: "A statement was not terminated with `;`." },
  { code: "S0004", name: "unclosed-parenthesis", category: "syntax", summary: "A `(` with no matching `)`." },
  { code: "S0005", name: "expected-slot-name", category: "syntax", summary: "`fix` / `mut` must be followed by a slot name." },

  // ── N · Name & binding — a name or slot rule is broken ────────────────────
  { code: "N0001", name: "undefined-name", category: "name", summary: "Use of a name with no slot in scope." },
  { code: "N0002", name: "duplicate-declaration", category: "name", summary: "Re-declaring a slot already declared in this scope." },
  { code: "N0003", name: "assign-to-fixed-slot", category: "name", summary: "Assigning to a slot created with `fix`." },
  { code: "N0004", name: "assign-to-undeclared", category: "name", summary: "Assigning to a name never created with `fix` / `mut`." },

  // ── T · Type & semantic — well-formed code breaks a static rule ───────────
  //    (Stage 1 catches these at runtime; T by nature, they migrate to the
  //     static checker in Stage 6 under the SAME codes.)
  { code: "T0001", name: "int-float-mix", category: "type", summary: "Mixing Int and Float in arithmetic or comparison; Ascent never converts automatically." },
  { code: "T0002", name: "division-needs-float", category: "type", summary: "`/` used on Ints — use `div` for whole-number division, or `toFloat`." },
  { code: "T0003", name: "div-needs-int", category: "type", summary: "`div` used on Floats — `div` is whole-number division only." },
  { code: "T0004", name: "non-bool-operand", category: "type", summary: "`and` / `or` / `not` applied to a non-Bool." },
  { code: "T0005", name: "operand-type-mismatch", category: "type", summary: "An operator received a type it doesn't accept (e.g. `true + 1`, `1 < true`)." },

  // ── R · Runtime — only running reveals it ─────────────────────────────────
  { code: "R0001", name: "division-by-zero", category: "runtime", summary: "Dividing by zero (`/`, `div`, or a future `mod`)." },
  { code: "R0002", name: "integer-overflow", category: "runtime", summary: "An Int operation overflowed 64 bits (Ascent traps, never wraps)." },
];

// Convenience lookups (the registry array is the source of truth).
export const byCode = new Map(REGISTRY.map((e) => [e.code, e]));
export const byName = new Map(REGISTRY.map((e) => [e.name, e]));
