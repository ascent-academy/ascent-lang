import type { Marker } from '../lexer/token.js';

// Thrown for a 'nature is runtime' crash (design.md §9): overflow, division
// by zero, index out of bounds, and the like. Carries a Marker so the CLI can
// run it through the same elaborate/render pipeline as every other
// diagnostic, rather than printing a bare Error string.
export class RuntimeError extends Error {
  public constructor(public readonly marker: Marker) {
    super(marker.code);
  }
}
