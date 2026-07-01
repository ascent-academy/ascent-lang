import type { Span } from './error-marker.js';

export type Expr = (
  | { kind: 'int'; value: bigint; span: Span }
  | { kind: 'float'; value: number; span: Span }
  | { kind: 'bool'; value: boolean; span: Span }
  | { kind: 'none'; span: Span }
  // `op` carries which operator this is — every future binary operator
  // (-, ==, and, ...) joins this same shape rather than getting its own
  // Expr kind.
  | { kind: 'binary'; op: '+' | '*'; left: Expr; right: Expr; span: Span }
);
