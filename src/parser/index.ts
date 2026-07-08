import type { Token, Marker } from '../lexer/token.js';
import { Lexer } from '../lexer/index.js';
import type { Program } from './ast.js';
import { TokenStream } from './token-stream.js';
import { parseStmt, parseBlock } from './stmt.js';
import { parseParam } from './type-expr.js';
import { typecheck } from '../check/index.js';
import type { TypedResult } from '../check/index.js';
import { elaborate } from '../errors/elaborate.js';

export interface ParseResult {
  program: Program | null;
  errorMarkers: Marker[];
}

// 'program (name: Type, …) { … }' — the entry point spelled as a function
// (whitepaper §11): a non-empty input list and a body block. The inputs become
// the program's `args`, and the body's statements its `stmts`, so downstream a
// wrapped program is indistinguishable from a bare one that happened to take
// inputs. An empty input list ('program ()') is banned (S0029) — a program with
// no inputs is written as a bare statement sequence, with no 'program' at all.
const parseProgramForm = (ts: TokenStream): Program | null => {
  ts.advance(); // consume 'program'

  const open = ts.expect('LPAREN', 'S0006');
  if (open === null) return null;

  const parsed = ts.parseSeparated(() => parseParam(ts), 'COMMA', 'RPAREN', 'S0001', false, open.span);
  if (parsed === null) return null;

  if (parsed.items.length === 0) {
    ts.report('S0029', { start: open.span.start, end: parsed.close.span.end });
    return null;
  }

  const openBrace = ts.expect('LBRACE', 'S0007');
  if (openBrace === null) return null;

  const body = parseBlock(ts, openBrace);
  if (body === null) return null;

  // The 'program' block is the whole program: nothing follows its closing '}'.
  if (ts.peek().kind !== 'EOF') {
    ts.report('S0030', ts.peek().span);
    return null;
  }

  return { args: parsed.items, stmts: body.stmts };
};

// A whole program is one of two shapes (whitepaper §11): a 'program (…) { … }'
// form with typed inputs, or — when it takes no inputs — a bare sequence of
// top-level statements whose last value is the output.
const parseProgram = (ts: TokenStream): Program | null => {
  if (ts.peek().kind === 'KW_PROGRAM') {
    return parseProgramForm(ts);
  }

  const parsed = ts.parseSeparated(
    () => parseStmt(ts), 'SEMICOLON', 'EOF', 'S0011', true
  );
  if (parsed === null) return null;

  return { args: [], stmts: parsed.items };
};

export const parseTokens = (tokens: Token[]): ParseResult => {
  const ts = new TokenStream(tokens);
  const program = parseProgram(ts);
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
