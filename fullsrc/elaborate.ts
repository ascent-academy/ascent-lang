// elaborate.ts — joins a raw {code, span, data} fact into a full Diagnostic by
// pulling category/severity from the registry and prose from the message module.
// Run once, lazily, when something is actually about to be shown.

import { byCode } from './errors.js';
import { MESSAGES } from './messages.js';
import type { Diagnostic, RawDiagnostic } from './diagnostic.js';

export function elaborate(raw: RawDiagnostic, source: string): Diagnostic {
  const entry = byCode.get(raw.code);
  if (!entry) throw new Error(`Unregistered error code: ${raw.code}`); // dev-time typo guard
  const builder = MESSAGES[raw.code];
  if (!builder) throw new Error(`No message builder for error code: ${raw.code}`);

  const text = source.slice(raw.span.start.offset, raw.span.end.offset);
  const built = builder(text, raw.span, raw.data ?? {});

  return {
    code: raw.code,
    category: entry.category,
    severity: 'error',
    message: built.message,
    explanation: built.explanation,
    primary: { span: raw.span, label: built.primaryLabel },
    fixes: built.fixes,
  };
}
