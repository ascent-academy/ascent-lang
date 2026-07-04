import type { Token, TokenKind, Marker, RelatedMarker, Span } from '../lexer/token.js';

// The token stream is everything the grammar productions in expr.ts,
// stmt.ts and type-expr.ts share but that isn't grammar itself: the
// cursor (peek/advance/peekNext), the error log, and the two
// stream-level combinators (expect, parseSeparated) built on top of
// them. Each production is a free function taking one of these, instead
// of a method on a monolithic Parser — so "how do I read the next
// token" lives in one place and the grammar files only describe grammar.
export class TokenStream {
  private readonly tokens: Token[];
  private pos: number = 0;

  // The accumulated diagnostics. Productions append via report()/expect();
  // the top-level parse() hands this straight out as errorMarkers.
  public readonly errors: Marker[] = [];

  public constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // The lexer guarantees the last token is always EOF, so the fallback
  // is only reached if pos somehow exceeds the array — it never will.
  public peek(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]!;
  }

  public advance(): Token {
    return this.tokens[this.pos++] ?? this.tokens[this.tokens.length - 1]!;
  }

  // Looks past the current token without consuming anything — needed to
  // tell an assignment ('x = …') apart from an expression starting with
  // a slot reference, which otherwise look identical for one token.
  public peekNext(): Token {
    return this.tokens[this.pos + 1] ?? this.tokens[this.tokens.length - 1]!;
  }

  // Record a diagnostic at a given span. The one place productions push
  // to the error log when they need to report something expect() can't
  // express (e.g. "this token was fine but the *next* thing is wrong").
  public report(code: string, span: Span, related?: RelatedMarker[]): void {
    const marker: Marker = { code, span };
    if (related !== undefined && related.length > 0) marker.related = related;
    this.errors.push(marker);
  }

  // Consume-or-diagnose: the shape every "expect this exact token here"
  // check in the grammar shares. Returns the consumed token, or records
  // `code` at the offending token's span and returns null. `related` carries
  // any supporting spans (e.g. the '(' this missing ')' should have closed).
  public expect(kind: TokenKind, code: string, related?: RelatedMarker[]): Token | null {
    const tok = this.peek();
    if (tok.kind !== kind) {
      this.report(code, tok.span, related);
      return null;
    }
    return this.advance();
  }

  // Keywords that start a statement outright (mirrors parseStmt's own
  // dispatch in stmt.ts). synchronize() treats one of these as a safe
  // place to resume, since it's a far more reliable restart point than
  // an arbitrary token that merely happens to also start an expression.
  private static readonly STMT_START_KINDS: ReadonlySet<TokenKind> = new Set(['KW_FIX', 'KW_MUT', 'KW_WHILE']);

  // Panic-mode recovery: skip tokens until the next statement boundary —
  // the separator, the enclosing close token, EOF, or a statement-start
  // keyword — without consuming whichever of those it lands on. Only
  // parseSeparated's `recover` path calls this; it never reports a
  // diagnostic itself, since the caller already recorded one for
  // whatever failed before giving up and calling this.
  private synchronize(sep: TokenKind, close: TokenKind): void {
    while (this.peek().kind !== sep && this.peek().kind !== close && this.peek().kind !== 'EOF') {
      if (TokenStream.STMT_START_KINDS.has(this.peek().kind)) return;
      this.advance();
    }
  }

  // Parses `item (sep item)* close`, allowing an empty list and a
  // trailing separator right before `close`. `close` is returned
  // alongside the items since callers need its span to close off the
  // enclosing node.
  //
  // Without `recover`, a failing item or a missing close token aborts
  // the whole list — the right call for a call's args or a list
  // literal, where a bad element can't be recovered from without
  // guessing. With `recover` (set only by parseBlock and parseProgram),
  // a failing item instead calls synchronize() and keeps going, so one
  // malformed statement doesn't take the rest of the file's diagnostics
  // down with it. The list can still come back null if synchronize()
  // runs all the way to EOF without ever finding `close`.
  // `openSpan`, when given, is the span of the opening delimiter (the '(', '{'
  // or '['); it rides along on the close-token error so an unclosed group can
  // point back at where it opened.
  public parseSeparated<T>(
    parseItem: () => T | null,
    sep: TokenKind,
    close: TokenKind,
    closeCode: string,
    recover = false,
    openSpan: Span | null = null,
  ): { items: T[]; close: Token } | null {
    const items: T[] = [];
    if (this.peek().kind !== close) {
      for (; ;) {
        const item = parseItem();
        if (item === null) {
          if (!recover) return null;
          this.synchronize(sep, close);
          if (this.peek().kind === close || this.peek().kind === 'EOF') break;
          if (this.peek().kind === sep) {
            this.advance(); // consume the separator synchronize stopped on
            if (this.peek().kind === close) break; // trailing separator after a recovered statement
          }
          continue;
        }
        items.push(item);
        if (this.peek().kind !== sep) break;
        this.advance(); // consume separator
        // Break on the close OR on end-of-input: a trailing separator right
        // before EOF means the group is simply unclosed, so fall straight to
        // the close-token error below instead of trying to parse another item
        // (which would spuriously demand an expression at end of file).
        if (this.peek().kind === close || this.peek().kind === 'EOF') break;
      }
    }
    const related: RelatedMarker[] = openSpan !== null ? [{ key: 'opener', span: openSpan }] : [];
    const closeTok = this.expect(close, closeCode, related);
    if (closeTok === null) return null;
    return { items, close: closeTok };
  }
}
