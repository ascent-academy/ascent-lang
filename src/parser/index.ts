import type { Token, Marker } from '../lexer/token.js';
import { Lexer } from '../lexer/index.js';
import type { Program } from './ast.js';
import { TokenStream } from './token-stream.js';
import { parseStmt } from './stmt.js';
import { parseArgsSection } from './type-expr.js';
import { typecheck } from '../check/index.js';
import type { TypedResult } from '../check/index.js';
import { elaborate } from '../errors/elaborate.js';

export interface ParseResult {
  program: Program | null;
  errorMarkers: Marker[];
}

export const parseTokens = (tokens: Token[]): ParseResult => {
  const ts = new TokenStream(tokens);
  const args = parseArgsSection(ts);
  if (args === null) {
    return { program: null, errorMarkers: ts.errors };
  }

  const parsed = ts.parseSeparated(
    () => parseStmt(ts), 'SEMICOLON', 'EOF', 'S0011', true
  );

  if (parsed === null) {
    return { program: null, errorMarkers: ts.errors };
  }

  const program: Program = {
    args,
    stmts: parsed.items
  };

  return { program, errorMarkers: ts.errors };
}

export const parse = (src: string): TypedResult => {
  const lexResult = new Lexer(src).tokenize();
  if (lexResult.errorMarkers.length > 0) {
    return {
      program: null,
      diagnostics: lexResult.errorMarkers.map(marker => elaborate(marker, src))
    };
  }

  const parseResult = parseTokens(lexResult.tokens);
  if (parseResult.program === null || parseResult.errorMarkers.length > 0) {
    return { program: null, diagnostics: parseResult.errorMarkers.map(marker => elaborate(marker, src)) };
  }

  return typecheck(parseResult.program, src);
}
