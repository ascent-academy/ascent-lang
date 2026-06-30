import type { Span } from './error-marker.js';

export type Expr = (
  | { kind: 'int'; value: bigint; span: Span }
  | { kind: 'float'; value: number; span: Span }
  | { kind: 'bool'; value: boolean; span: Span }
  | { kind: 'none'; span: Span }
);
