// diagnostic.ts — the structured error value produced by every stage of the
// Ascent toolchain (lexer, parser, name resolver, type checker, runtime).
//
// Design rule: a Diagnostic is PURE DATA, free of presentation. It contains no
// ASCII art, carets, HTML, or colour. A renderer (web editor, REPL, terminal,
// LSP adapter) turns one Diagnostic into pixels. The same value can drive an
// inline editor squiggle, a hover card, an "Apply fix" button, or a plain
// terminal print — so the compiler never has to know where it will be shown.

/** A point in the source: absolute offset for editors, line/column for humans. */
export interface Position {
  /** 0-based index into the source string (UTF-16 code units in JS) — what
   *  CodeMirror / Monaco want for placing decorations. */
  offset: number;
  /** 1-based line, for display. */
  line: number;
  /** 1-based column, for display. */
  column: number;
}

/** A half-open source range [start, end) — end exclusive, matching editor APIs. */
export interface Span {
  start: Position;
  end: Position;
  /** Module/file id; absent in single-file Stage 1, set once modules arrive. */
  source?: string;
}

/** A span carrying a short note, e.g. "Int" beneath one operand, or
 *  "declared fixed here" beneath an earlier line. */
export interface LabeledSpan {
  span: Span;
  label?: string;
}

/** A single text replacement. One or more applied together form a fix. */
export interface TextEdit {
  /** Range to replace. */
  span: Span;
  /** Text to insert in its place. */
  replacement: string;
}

/** A concrete, machine-applicable fix — powers a one-click "Apply fix" button. */
export interface SuggestedFix {
  /** Human label for the button/menu: "Convert width with toFloat(width)". */
  title: string;
  /** Edits applied atomically. */
  edits: TextEdit[];
}

export type Severity = "error" | "warning" | "info";

/** The five stable error families. The letter is the first char of `code`. */
export type Category = "lexical" | "syntax" | "name" | "type" | "runtime";

/** What a compiler stage (lexer, parser, checker, runtime) emits: a stable code
 *  plus the span it covers, and optional structured data for the rare message a
 *  source slice can't reconstruct. A later join step (`elaborate`) turns this
 *  into a full Diagnostic by pulling category from the registry and prose from
 *  the message module — so no stage ever holds a user-facing sentence. */
export interface RawDiagnostic {
  code: string;
  span: Span;
  data?: Record<string, unknown>;
}

export interface Diagnostic {
  /** Stable, doc-referenceable code; never reused, never renumbered. First
   *  letter encodes the category (L/S/N/T/R) — e.g. "T0042". */
  code: string;

  /** Mirrors code[0]; carried explicitly so consumers can switch on it without
   *  parsing the string. Must agree with `code`. */
  category: Category;

  severity: Severity;

  /** One-line, plain-language headline. No compiler jargon. The compiler takes
   *  the blame, never the student: "I found a math expression mixing an Int and
   *  a Float." */
  message: string;

  /** Optional teaching paragraph: WHY this is a rule. For a learner the error is
   *  also the lesson. Rendered in a panel / hover, not inline. Plain text. */
  explanation?: string;

  /** The location the error points at — focus of the squiggle / scroll target. */
  primary: LabeledSpan;

  /** Supporting spans that clarify: the other operand, the original
   *  declaration, the unhandled variant. Same file or another. */
  related?: LabeledSpan[];

  /** Concrete fixes, best first. Each can become a clickable action. */
  fixes?: SuggestedFix[];
}

// The docs URL is DERIVED, not stored, so it can never drift from the code:
//
//   export const DOCS_BASE = "https://ascent-lang.org";
//   export const docsUrl = (d: Diagnostic) => `${DOCS_BASE}/errors/${d.code}`;
