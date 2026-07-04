import type { Token, Marker } from '../lexer/token.js';
import type { ArgDef, Program } from './ast.js';
import { TokenStream } from './token-stream.js';
import { parseStmt } from './stmt.js';
import { parseArgs } from './type-expr.js';

export interface ParseResult {
  program: Program | null;
  errorMarkers: Marker[];
}

// The program is an optional 'args (…);' header followed by a
// semicolon-separated run of statements up to EOF — the same
// "item (sep item)* close" shape as a block, with EOF standing in for
// the closing brace. `recover` is on, so a malformed statement is
// synchronized past rather than aborting the whole parse.
function parseProgram(ts: TokenStream): Program | null {
  let args: ArgDef[] = [];
  if (ts.peek().kind === 'KW_ARGS') {
    const result = parseArgs(ts);
    if (result === null) return null;
    args = result;

    if (ts.expect('SEMICOLON', 'S0011') === null) return null;
  }

  const parsed = ts.parseSeparated(() => parseStmt(ts), 'SEMICOLON', 'EOF', 'S0011', true);
  if (parsed === null) return null;

  return { args, stmts: parsed.items };
}

// The parser's public entry point. Phase 5 moved the grammar into
// free functions over a TokenStream (token-stream.ts, expr.ts, stmt.ts,
// type-expr.ts); this class is the thin wiring that owns the stream for
// one parse and exposes the same `new Parser(tokens).parse()` API the
// rest of the toolchain calls.
export class Parser {
  private readonly tokens: Token[];

  public constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parse(): ParseResult {
    const ts = new TokenStream(this.tokens);
    const program = parseProgram(ts);
    return { program, errorMarkers: ts.errors };
  }
}
