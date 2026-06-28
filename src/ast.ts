import type { Span } from './error-marker.js';

export interface Literal {
  kind: 'Literal';
  value: bigint;
  span: Span;
}

export type Expr = Literal;
