import type { Span } from '../lexer/token.js';
import { RuntimeError } from '../errors/runtime-error.js';
import type { Environment } from './env.js';
import { isInt64 } from './arithmetic.js';
import { intVal, floatVal, boolVal, strVal, type RuntimeValue, type PreludeAsyncFn } from './values.js';

// One line of input, or the R0013 crash when there's none left to give — the
// only way v1's synchronous interpreter can signal a closed stdin, since a
// prompt (unlike parsing a file) never has an Optional/Result to hand back
// instead (docs/version-0.1/stdlib/prelude.md).
const askLine = (message: string, env: Environment, span: Span): string => {
  const line = env.readLine(message);
  if (line === null) throw new RuntimeError({ code: 'R0013', span });
  return line;
};

// Mirrors the CLI's --flag validation (src/index.ts's bindArgs) — "same
// types, same validation" as program's own boundary (prelude.md) — but each
// returns null on bad input instead of exiting, so the caller can re-ask.
const tryParseInt = (raw: string): RuntimeValue | null => {
  if (!/^-?\d+$/.test(raw)) return null;
  const parsed = BigInt(raw);
  return isInt64(parsed) ? intVal(parsed) : null;
};

const tryParseFloat = (raw: string): RuntimeValue | null => {
  const n = Number(raw);
  return Number.isNaN(n) || !Number.isFinite(n) ? null : floatVal(n);
};

const tryParseBool = (raw: string): RuntimeValue | null =>
  raw === 'true' ? boolVal(true) : raw === 'false' ? boolVal(false) : null;

// Runs a builtin prompt Task on 'await' (whitepaper §8 — a Task's body runs
// synchronously here, same as a user async fn's). 'prompt' itself can't fail
// (any line is valid text); the typed trio re-ask on a bad parse — "keep
// asking until valid" is the honest interactive semantics (prelude.md) — so
// only end-of-input, not a bad parse, ever crashes this.
export const runPromptTask = (
  builtin: PreludeAsyncFn, message: string, env: Environment, span: Span,
): RuntimeValue => {
  if (builtin === 'prompt') return strVal(askLine(message, env, span));

  const parse = builtin === 'promptInt' ? tryParseInt : builtin === 'promptFloat' ? tryParseFloat : tryParseBool;
  while (true) {
    const parsed = parse(askLine(message, env, span));
    if (parsed !== null) return parsed;
  }
};
