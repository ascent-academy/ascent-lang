import type { Span } from '../lexer/token.js';
import { RuntimeError } from '../errors/runtime-error.js';
import type { Environment } from './env.js';
import { intVal, floatVal, boolVal, strVal, type RuntimeValue, type PreludeAsyncFn } from './values.js';

// A missing value from the host — R0013, the only failure mode the prompt
// family has (docs/version-0.1/stdlib/prelude.md): validation and any
// re-asking already happened inside the host's ask* call, so a null here
// means it truly gave up (a closed stdin, a cancelled dialog, …).
const orCrash = <T>(value: T | null, span: Span): T => {
  if (value === null) throw new RuntimeError({ code: 'R0013', span });
  return value;
};

// Runs a builtin prompt Task on 'await' (whitepaper §8). Each just asks the
// host for a value of the right kind through the matching Environment method
// (env.ts's askText/askInt/askFloat/askBool, themselves thin forwarders to
// Host.capabilities.console) — the host owns the whole interaction now, so
// there is no parsing or re-ask loop left here at all.
export const runPromptTask = async (
  builtin: PreludeAsyncFn, message: string, env: Environment, span: Span,
): Promise<RuntimeValue> => {
  switch (builtin) {
    case 'prompt': return strVal(orCrash(await env.askText(message), span));
    case 'promptInt': return intVal(orCrash(await env.askInt(message), span));
    case 'promptFloat': return floatVal(orCrash(await env.askFloat(message), span));
    case 'promptBool': return boolVal(orCrash(await env.askBool(message), span));
  }
};
