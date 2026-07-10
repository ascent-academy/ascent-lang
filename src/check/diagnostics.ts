import type { Marker, Span } from '../lexer/token.js';
import type { AscentType } from '../types/types.js';
import { INVALID_TYPE, typeToString } from '../types/types.js';
import { Diagnostic, elaborate } from '../errors/elaborate.js';

// ---- Diagnostics sink -------------------------------------------------
//
// Replaces the Marker[] that used to thread through every judgment
// (agenda/typechecker-refactor.md Phase 5a). Productions call error() as
// they go; typecheck() elaborates the whole batch against the source once,
// at the very end, instead of each call site carrying an array reference.
export class Diagnostics {
  private readonly markers: Marker[] = [];

  public error(marker: Marker): void {
    this.markers.push(marker);
  }

  public get hasErrors(): boolean {
    return this.markers.length > 0;
  }

  public elaborate(source: string): Diagnostic[] {
    return this.markers.map(m => elaborate(m, source));
  }
}

export const requireArity = (expected: number, got: number, diagnostics: Diagnostics, span: Span): boolean => {
  if (got !== expected) {
    diagnostics.error({ code: 'T0014', span, data: { expected: String(expected), got: String(got) } });
    return false;
  }
  return true;
};

// A value-type mismatch that carries the expected and actual type names.
// Reports the diagnostic and hands back Invalid — the checker-internal
// tombstone (agenda/typechecker-refactor.md Phase 5) for a node whose own
// check just failed — so callers can fold it straight into the node they're
// building instead of branching on a separate null case.
export const typeMismatch = (
  code: string, diagnostics: Diagnostics, span: Span, expected: AscentType, actual: AscentType,
  related: { key: string; span: Span }[] = [],
): AscentType => {
  diagnostics.error({
    code, span, related,
    data: { expected: typeToString(expected), actual: typeToString(actual) },
  });
  return INVALID_TYPE;
};

// An operator applied to operands it doesn't accept (T0008). `operands` is the
// joined list of type names — one for a unary '-', two for a binary operator.
export const operandError = (diagnostics: Diagnostics, op: string, span: Span, ...operands: AscentType[]): AscentType => {
  diagnostics.error({ code: 'T0008', span, data: { op, operands: operands.map(typeToString).join(' and ') } });
  return INVALID_TYPE;
};
