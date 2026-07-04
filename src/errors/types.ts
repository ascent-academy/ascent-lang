// Append-only registry of every diagnostic code emitted by this stage.
// A code is permanent — never reused, never renumbered, never deleted.
// To retire one, set retired: true and leave the row in the YAML.

export type Category = 'lexical' | 'syntactic' | 'name' | 'type' | 'runtime';

// A concrete, machine-applicable correction. Authored ONLY when the fix is
// certain and unambiguous (see the wording rules in the .yml files); an
// uncertain guess is left to the reader / the LLM engine, not baked in here.
export interface Fix {
  title: string;        // human label for the action, e.g. "Write '0.5'"
  replacement: string;  // text to put in place of the offending span
}

// A generic illustration of the rule — NOT "your code, fixed". `valid` shows a
// well-formed form, `invalid` a broken one, so the pair teaches the rule
// without guessing what the author actually meant.
export interface Example {
  valid: string;
  invalid: string;
}

// A label for a supporting span. `key` pairs it with the RelatedMarker the
// checker emits (by role); `label` is the prose shown beside that span and may
// contain {found}. If the checker doesn't supply a span for this key (e.g. the
// declaration has no source location), the label is simply dropped.
export interface RelatedLabel {
  key: string;
  label: string;
}

// A condition on the offending source text (`found`). The first variant whose
// `when` matches overrides the base fields it specifies. Kept deliberately tiny
// — these two forms cover every value-keyed case the lexer produces.
export interface When {
  equals?: string;
  startsWith?: string;
}

// A tailored override for a specific found text (e.g. a stray '!'). It overrides
// only the fields it sets; anything unset is inherited from the base entry.
export interface Variant {
  when: When;
  message?: string;
  explanation?: string;
  fix?: Fix;
  example?: Example;
}

export interface ErrorEntry {
  code: string;
  name: string;
  category: Category;
  // One neutral line for the error catalogue / docs index.
  summary: string;
  // The in-context headline shown to the reader. May contain {found}. When
  // absent, the elaborator falls back to `summary`.
  message?: string;
  // The micro-lesson: FACTS about the language rule only, in beginner words.
  // May contain {found}. Doubles as grounding for the LLM engine.
  explanation?: string;
  fix?: Fix;
  example?: Example;
  // Labels for supporting spans, keyed to the RelatedMarkers the checker emits.
  related?: RelatedLabel[];
  variants?: Variant[];
  retired?: boolean;
}
