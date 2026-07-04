import { byCode } from './index.js';
import type { Category, Example, When } from './types.js';
import type { Marker, Span } from '../lexer/token.js';

export interface ResolvedFix {
  title: string;
  span: Span;
  replacement: string;
}

export interface Diagnostic {
  code: string;
  category: Category;
  severity: 'error';
  message: string;
  explanation: string | null;
  span: Span;
  fix: ResolvedFix | null;
  example: Example | null;
}

const fill = (template: string, found: string): string =>
  template.replaceAll('{found}', found);

const matches = (when: When, found: string): boolean =>
  (when.equals === undefined || found === when.equals) &&
  (when.startsWith === undefined || found.startsWith(when.startsWith));

export function elaborate(marker: Marker, source: string): Diagnostic {
  const entry = byCode.get(marker.code);
  if (entry === undefined) {
    throw new Error(`Unregistered error code: ${marker.code}`); // dev-time typo guard
  }

  const span = marker.span;
  const found = source.slice(span.start.offset, span.end.offset);

  // First matching variant wins; it overrides only the fields it sets, so
  // everything else falls through to the base entry.
  const variant = entry.variants?.find(v => matches(v.when, found)) ?? null;

  const message = fill(variant?.message ?? entry.message ?? entry.summary, found);
  const rawExplanation = variant?.explanation ?? entry.explanation ?? null;
  const fixSpec = variant?.fix ?? entry.fix ?? null;

  return {
    code: entry.code,
    category: entry.category,
    severity: 'error',
    message,
    explanation: rawExplanation === null ? null : fill(rawExplanation, found),
    span,
    fix: fixSpec === null ? null : {
      title: fill(fixSpec.title, found),
      span,
      replacement: fill(fixSpec.replacement, found),
    },
    example: variant?.example ?? entry.example ?? null,
  };
}
