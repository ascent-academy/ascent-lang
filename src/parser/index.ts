import type { Token, Marker } from '../lexer/token.js';
import { Lexer } from '../lexer/index.js';
import type { Program, Statement } from './ast.js';
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
// (whitepaper §11): a non-empty input list and a body block. Any `leading`
// statements parsed before it (declarations, or plain statements — anything is
// allowed *before* 'program') run first, so the flattened `stmts` is
// leading-then-body and downstream a wrapped program is indistinguishable from a
// bare one. An empty input list ('program ()') is banned (S0029) — a program
// with no inputs is written as a bare statement sequence, no 'program' at all —
// and nothing may follow the block (S0030): 'program' is always the last thing.
const parseProgramForm = (ts: TokenStream, leading: Statement[]): Program | null => {
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

  // Nothing follows the 'program' block — anything can go *before* it, nothing
  // after (its closing '}' ends the file).
  if (ts.peek().kind !== 'EOF') {
    ts.report('S0030', ts.peek().span);
    return null;
  }

  // The leading statements run first (Done-required setup); the body begins
  // right after them, which is where the inputs come into scope.
  return { args: parsed.items, stmts: [...leading, ...body.stmts], bodyStart: leading.length };
};

// A whole program is one of two shapes (whitepaper §11): a bare sequence of
// top-level statements whose last value is the output, or that same sequence
// followed by a 'program (…) { … }' form that adds typed inputs and holds the
// executable body. Either way it's parsed as one statement list; when it reaches
// a 'program' the soft-stop hands control to parseProgramForm, which folds the
// statements seen so far in ahead of the body.
const parseProgram = (ts: TokenStream): Program | null => {
  const parsed = ts.parseSeparated(
    () => parseStmt(ts), 'SEMICOLON', 'EOF', 'S0011', true, null, 'KW_PROGRAM',
  );
  if (parsed === null) return null;

  if (parsed.close.kind === 'KW_PROGRAM') {
    return parseProgramForm(ts, parsed.items);
  }

  // Bare form: no 'program', no inputs — every statement is body (bodyStart 0).
  return { args: [], stmts: parsed.items, bodyStart: 0 };
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
