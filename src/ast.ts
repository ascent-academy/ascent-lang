import type { Span } from './error-marker.js';

export type Expr = (
  | { kind: 'int'; value: bigint; span: Span }
  | { kind: 'float'; value: number; span: Span }
  | { kind: 'bool'; value: boolean; span: Span }
  | { kind: 'none'; span: Span }
  // '+' is the only infix operator so far, so `op` has one possible value —
  // it stays a field (not a separate 'plus' Expr kind) because every future
  // binary operator (-, *, ==, and, ...) will join this same shape.
  | { kind: 'binary'; op: '+'; left: Expr; right: Expr; span: Span }
);
