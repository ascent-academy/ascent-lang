import type { Token, TokenKind } from '../lexer/token.js';
import type { Marker } from '../lexer/token.js';
import type { Expr, Statement, Program, Block, If, BinaryOp, UnaryOp, ArgDef, ArgType, TypeExpr } from './ast.js';

export interface ParseResult {
  program: Program | null;
  errorMarkers: Marker[];
}

export class Parser {
  private tokens: Token[];
  private pos: number = 0;
  private errorMarkers: Marker[] = [];

  public constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // The lexer guarantees the last token is always EOF, so the fallback
  // is only reached if pos somehow exceeds the array — it never will.
  private peek(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    return this.tokens[this.pos++] ?? this.tokens[this.tokens.length - 1]!;
  }

  // Looks past the current token without consuming anything — needed to
  // tell an assignment ('x = …') apart from an expression starting with
  // a slot reference, which otherwise look identical for one token.
  private peekNext(): Token {
    return this.tokens[this.pos + 1] ?? this.tokens[this.tokens.length - 1]!;
  }

  // Consume-or-diagnose: the shape every "expect this exact token here"
  // check in the grammar shares. Returns the consumed token, or records
  // `code` at the offending token's span and returns null.
  private expect(kind: TokenKind, code: string): Token | null {
    const tok = this.peek();
    if (tok.kind !== kind) {
      this.errorMarkers.push({ code, span: tok.span });
      return null;
    }
    return this.advance();
  }

  // Keywords that start a statement outright (mirrors parseStmt's own
  // dispatch below). synchronize() treats one of these as a safe place
  // to resume, since it's a far more reliable restart point than an
  // arbitrary token that merely happens to also start an expression.
  private static readonly STMT_START_KINDS: ReadonlySet<TokenKind> = new Set(['KW_FIX', 'KW_MUT', 'KW_WHILE']);

  // Panic-mode recovery: skip tokens until the next statement boundary —
  // the separator, the enclosing close token, EOF, or a statement-start
  // keyword — without consuming whichever of those it lands on. Only
  // parseSeparated's `recover` path calls this; it never reports a
  // diagnostic itself, since the caller already recorded one for
  // whatever failed before giving up and calling this.
  private synchronize(sep: TokenKind, close: TokenKind): void {
    while (this.peek().kind !== sep && this.peek().kind !== close && this.peek().kind !== 'EOF') {
      if (Parser.STMT_START_KINDS.has(this.peek().kind)) return;
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
  private parseSeparated<T>(
    parseItem: () => T | null,
    sep: TokenKind,
    close: TokenKind,
    closeCode: string,
    recover = false,
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
        if (this.peek().kind === close) break; // trailing separator
      }
    }
    const closeTok = this.expect(close, closeCode);
    if (closeTok === null) return null;
    return { items, close: closeTok };
  }

  // ---- Pratt parsing --------------------------------------------------
  //
  // A Pratt parser recognises an expression as an atom (a "nud" — null
  // denotation, a value that doesn't look left at anything) optionally
  // followed by a chain of infix or postfix operators (each a "led" —
  // left denotation, because it combines the value already parsed with
  // whatever comes after it).
  //
  // Every operator — prefix, infix, or postfix — has a binding power: a
  // number saying how tightly it grabs its operands. Higher binds
  // tighter — that's what encodes precedence: '*' outbinds '+', so
  // `1 + 2 * 3` parses as `1 + (2 * 3)`, not `(1 + 2) * 3`. The parsing
  // loop only accepts an operator when its binding power is at least
  // `minBp` — the "how tight does the *caller* need things bound"
  // threshold passed down on each recursive call.
  //
  // This ladder is the single source of truth for what binds tighter
  // than what: postfix (`.method()`, `[index]`) binds tightest, then
  // unary '-', then '*'/'/'/'div'/'mod', then '+'/'-', then the
  // comparisons, loosest. Every table below is keyed off these numbers
  // instead of inlining its own.
  private static readonly BP = {
    COMPARISON: 1,
    ADDITIVE: 2,
    MULTIPLICATIVE: 3,
    UNARY: 4,
    POSTFIX: 4,
  } as const;

  // Every binary operator this parser knows about has one row in this
  // table. Adding the next one means adding a row, never touching the
  // loop below. '*', '/', 'div' and 'mod' all share a binding power —
  // they're the same precedence tier — so all four outbind '+', which
  // in turn outbinds the comparisons — `1 + 2 < 3 * 4` groups as
  // `(1 + 2) < (3 * 4)`. Comparisons are also marked `assoc: 'none'`:
  // unlike '+' or '*', two of them can never sit side by side
  // (`a < b < c` is rejected, not silently grouped one way or the other).
  private static readonly INFIX_OPS: Partial<Record<TokenKind, { op: BinaryOp; bp: number; assoc: 'left' | 'none' }>> = {
    EQ_EQ: { op: '==', bp: Parser.BP.COMPARISON, assoc: 'none' },
    BANG_EQ: { op: '!=', bp: Parser.BP.COMPARISON, assoc: 'none' },
    LT: { op: '<', bp: Parser.BP.COMPARISON, assoc: 'none' },
    LT_EQ: { op: '<=', bp: Parser.BP.COMPARISON, assoc: 'none' },
    GT: { op: '>', bp: Parser.BP.COMPARISON, assoc: 'none' },
    GT_EQ: { op: '>=', bp: Parser.BP.COMPARISON, assoc: 'none' },
    PLUS: { op: '+', bp: Parser.BP.ADDITIVE, assoc: 'left' },
    MINUS: { op: '-', bp: Parser.BP.ADDITIVE, assoc: 'left' },
    STAR: { op: '*', bp: Parser.BP.MULTIPLICATIVE, assoc: 'left' },
    SLASH: { op: '/', bp: Parser.BP.MULTIPLICATIVE, assoc: 'left' },
    KW_DIV: { op: 'div', bp: Parser.BP.MULTIPLICATIVE, assoc: 'left' },
    KW_MOD: { op: 'mod', bp: Parser.BP.MULTIPLICATIVE, assoc: 'left' },
  };

  // Postfix table — dot-calls and indexing are "led" operators exactly
  // like the binary ones above (they look left at the value already
  // parsed), so they're declared here and dispatched on in the loop
  // below instead of being special-cased ahead of the INFIX_OPS lookup.
  // Both bind at POSTFIX — tighter than unary or any binary operator —
  // which is why `-a.b()[0]` parses as `-(a.b()[0])`.
  private static readonly POSTFIX_OPS: Partial<Record<TokenKind, { bp: number }>> = {
    DOT: { bp: Parser.BP.POSTFIX },
    LBRACKET: { bp: Parser.BP.POSTFIX },
  };

  // Prefix table — unary '-' is the Pratt parser's other operator kind
  // (a "nud" that still takes an operand, parsed in parseAtom below).
  // Only one entry today, but its binding power is declared here rather
  // than inlined at the call site.
  private static readonly PREFIX_OPS: Partial<Record<TokenKind, { op: UnaryOp; bp: number }>> = {
    MINUS: { op: '-', bp: Parser.BP.UNARY },
  };

  private parseExpr(minBp = 0): Expr | null {
    let left = this.parseAtom();
    if (left === null) {
      return null;
    }

    // Tracks whether a non-associative (comparison-tier) operator has
    // already been consumed at this call's level — a second one directly
    // beside it (`a < b < c`) is a chain, not a grouping choice, so it's
    // rejected here rather than silently parsed left- or right-first.
    let chained = false;

    while (true) {
      const kind = this.peek().kind;

      // Postfix: expr.method(args) or expr[index] — dispatched by table
      // rather than special-cased ahead of the INFIX_OPS lookup below.
      const postfix = Parser.POSTFIX_OPS[kind];
      if (postfix !== undefined) {
        if (postfix.bp < minBp) break;
        left = kind === 'DOT' ? this.parseMethodCall(left) : this.parseIndex(left);
        if (left === null) return null;
        continue;
      }

      const infix = Parser.INFIX_OPS[kind];
      if (infix === undefined || infix.bp < minBp) {
        break;
      }

      if (infix.assoc === 'none') {
        if (chained) {
          this.errorMarkers.push({ code: 'S0008', span: this.peek().span });
          return null;
        }
        chained = true;
      }

      this.advance(); // consume the operator

      // Left-associativity — `1 + 2 + 3` must parse as `(1 + 2) + 3`,
      // not `1 + (2 + 3)`. Parsing the right-hand side with `bp + 1`
      // (instead of `bp`) is what enforces that: it stops a second '+'
      // from being absorbed into the *right* operand, forcing it to
      // instead be picked up by the loop one level up. Non-associative
      // operators reuse the same `bp + 1` call — it still keeps looser
      // operators out of the right operand, and the `chained` check
      // above is what stops them from reappearing at this level.
      const right = this.parseExpr(infix.bp + 1);
      if (right === null) {
        return null;
      }

      left = {
        kind: 'binary',
        op: infix.op,
        left,
        right,
        span: { start: left.span.start, end: right.span.end }
      };
    }

    return left;
  }

  // 'receiver.method(args)' — DOT already confirmed on lookahead by the
  // Pratt loop; this consumes it through the closing ')'.
  private parseMethodCall(receiver: Expr): Expr | null {
    this.advance(); // consume '.'

    const methodTok = this.peek();
    if (methodTok.kind !== 'SLOT') {
      this.errorMarkers.push({ code: 'S0012', span: methodTok.span });
      return null;
    }
    this.advance(); // consume method name

    if (this.peek().kind !== 'LPAREN') {
      this.errorMarkers.push({ code: 'S0001', span: this.peek().span });
      return null;
    }
    this.advance(); // consume '('

    const parsed = this.parseSeparated(() => this.parseExpr(), 'COMMA', 'RPAREN', 'S0001');
    if (parsed === null) return null;

    return {
      kind: 'methodCall',
      receiver,
      method: methodTok.value,
      args: parsed.items,
      span: { start: receiver.span.start, end: parsed.close.span.end },
    };
  }

  // 'list[index]' — LBRACKET already confirmed on lookahead by the Pratt loop.
  private parseIndex(list: Expr): Expr | null {
    this.advance(); // consume '['

    const index = this.parseExpr();
    if (index === null) return null;

    const rbracket = this.expect('RBRACKET', 'S0013');
    if (rbracket === null) return null;

    return {
      kind: 'index',
      list,
      index,
      span: { start: list.span.start, end: rbracket.span.end },
    };
  }

  // parseAtom parses the smallest possible expression: a single literal
  // that doesn't depend on any operator. This is the Pratt parser's nud —
  // every future one (parenthesized groups, unary '-', identifiers) is
  // just another case added here, never a change to the loop above.
  private parseAtom(): Expr | null {
    const tok = this.peek();

    if (tok.kind === 'INT_LIT') {
      this.advance();
      return {
        kind: 'literal',
        valueType: 'Int',
        value: BigInt(tok.value),
        span: tok.span
      };
    }

    if (tok.kind === 'FLOAT_LIT') {
      this.advance();
      return {
        kind: 'literal',
        valueType: 'Float',
        value: parseFloat(tok.value),
        span: tok.span
      };
    }

    if (tok.kind === 'STR_LIT') {
      this.advance();
      return { kind: 'literal', valueType: 'String', value: tok.value, span: tok.span };
    }

    if (tok.kind === 'BOOL_LIT') {
      this.advance();
      return {
        kind: 'literal',
        valueType: 'Bool',
        value: tok.value === 'True',
        span: tok.span
      };
    }

    if (tok.kind === 'NONE_LIT') {
      this.advance();
      return { kind: 'literal', valueType: 'None', span: tok.span };
    }

    if (tok.kind === 'DONE_LIT') {
      this.advance();
      return { kind: 'literal', valueType: 'Done', span: tok.span };
    }

    if (tok.kind === 'SLOT') {
      this.advance();
      if (this.peek().kind === 'LPAREN') {
        return this.parseCall(tok);
      }
      return { kind: 'slot', name: tok.value, span: tok.span };
    }

    if (tok.kind === 'LPAREN') {
      this.advance();
      const inner = this.parseExpr();
      if (inner === null) {
        return null;
      }
      const closing = this.peek();
      if (closing.kind !== 'RPAREN') {
        this.errorMarkers.push({ code: 'S0001', span: closing.span });
        return null;
      }
      this.advance(); // consume ')'
      return inner;
    }

    const prefix = Parser.PREFIX_OPS[tok.kind];
    if (prefix !== undefined) {
      const start = tok.span.start;
      this.advance();
      const operand = this.parseExpr(prefix.bp);
      if (operand === null) {
        return null;
      }
      return { kind: 'unary', op: prefix.op, operand, span: { start, end: operand.span.end } };
    }

    if (tok.kind === 'LBRACKET') {
      return this.parseList();
    }

    if (tok.kind === 'LBRACE') {
      return this.parseBlock();
    }

    if (tok.kind === 'KW_IF') {
      return this.parseIf();
    }

    this.errorMarkers.push({ code: 'S0002', span: tok.span });
    return null;
  }

  // 'name(arg, arg, …)' — callee token already consumed by parseAtom.
  private parseCall(callee: Token): Expr | null {
    this.advance(); // consume '('
    const parsed = this.parseSeparated(() => this.parseExpr(), 'COMMA', 'RPAREN', 'S0001');
    if (parsed === null) return null;

    return {
      kind: 'call',
      callee: callee.value,
      args: parsed.items,
      span: { start: callee.span.start, end: parsed.close.span.end },
    };
  }

  // '[' expr, expr, … ']' — list literal. Already consumed '[' in parseAtom.
  private parseList(): Expr | null {
    const openTok = this.advance(); // consume '['
    const parsed = this.parseSeparated(() => this.parseExpr(), 'COMMA', 'RBRACKET', 'S0013');
    if (parsed === null) return null;

    return { kind: 'list', elements: parsed.items, span: { start: openTok.span.start, end: parsed.close.span.end } };
  }

  // A block is '{' stmt* '}', each statement separated by ';' — the
  // same "item (sep item)* close" shape as a call's args or a list
  // literal, just with SEMICOLON as the separator and RBRACE as the
  // close (§ design.md: "semicolons terminate every statement"; the
  // trailing one is optional exactly like a list's trailing comma).
  // `openTok` lets parseRequiredBlock pass in a '{' it already consumed
  // via `expect`; parseAtom, which hasn't consumed one, omits it and
  // this consumes its own.
  private parseBlock(openTok?: Token): Block | null {
    openTok ??= this.advance(); // consume '{' unless already consumed
    const parsed = this.parseSeparated(() => this.parseStmt(), 'SEMICOLON', 'RBRACE', 'S0005', true);
    if (parsed === null) return null;

    return { kind: 'block', stmts: parsed.items, span: { start: openTok.span.start, end: parsed.close.span.end } };
  }

  // The parenthesized test shared by 'if' and 'while' — '(' expr ')'.
  // The body braces already delimit the construct, but the test stays
  // parenthesized to match the C-family/TS surface (§5).
  private parseCond(): Expr | null {
    if (this.expect('LPAREN', 'S0006') === null) return null;

    const cond = this.parseExpr();
    if (cond === null) {
      return null;
    }

    if (this.expect('RPAREN', 'S0001') === null) return null;

    return cond;
  }

  // A mandatory body block — every 'if'/'while' branch needs one, even
  // single-statement (§2: no dangling-else, no goto-fail class of bug).
  private parseRequiredBlock(): Block | null {
    const openTok = this.expect('LBRACE', 'S0007');
    if (openTok === null) return null;
    return this.parseBlock(openTok);
  }

  // 'if (cond) { } else if (cond) { } else { }' — 'else if' is not its
  // own grammar rule, it's an If recursively parsed as the else branch.
  private parseIf(): If | null {
    const ifTok = this.advance(); // consume 'if'

    const cond = this.parseCond();
    if (cond === null) {
      return null;
    }

    const thenBlock = this.parseRequiredBlock();
    if (thenBlock === null) {
      return null;
    }

    let elseBranch: Block | If | null = null;
    if (this.peek().kind === 'KW_ELSE') {
      this.advance(); // consume 'else'
      elseBranch = this.peek().kind === 'KW_IF' ? this.parseIf() : this.parseRequiredBlock();
      if (elseBranch === null) {
        return null;
      }
    }

    return {
      kind: 'if',
      cond,
      then: thenBlock,
      else: elseBranch,
      span: { start: ifTok.span.start, end: (elseBranch ?? thenBlock).span.end },
    };
  }

  // 'while (cond) { }' — a statement, not an expression (§5): a loop has
  // no single meaningful result, so it isn't usable where a value is
  // expected the way 'if' is.
  private parseWhile(): Statement | null {
    const whileTok = this.advance(); // consume 'while'

    const cond = this.parseCond();
    if (cond === null) {
      return null;
    }

    const body = this.parseRequiredBlock();
    if (body === null) {
      return null;
    }

    return { kind: 'while', cond, body, span: { start: whileTok.span.start, end: body.span.end } };
  }

  // ---- Statement parsing ----------------------------------------------

  // 'Int', 'Float', 'Bool', 'String', or 'List<Type>' — used in type annotations.
  private parseTypeExpr(): TypeExpr | null {
    const tok = this.peek();
    if (tok.kind !== 'TYPE_NAME') {
      this.errorMarkers.push({ code: 'S0010', span: tok.span });
      return null;
    }
    this.advance(); // consume type name

    if (tok.value === 'List') {
      if (this.expect('LT', 'S0010') === null) return null;

      const elem = this.parseTypeExpr();
      if (elem === null) return null;

      const gt = this.expect('GT', 'S0010');
      if (gt === null) return null;

      return { kind: 'ListType', elem, span: { start: tok.span.start, end: gt.span.end } };
    }

    const name = tok.value as 'Int' | 'Float' | 'Bool' | 'String';
    return { kind: 'TypeName', name, span: tok.span };
  }

  // 'fix' and 'mut' share every rule but the keyword itself and the
  // mutability it grants — one parse method, told which by 'kind'.
  private parseDecl(kind: 'fix' | 'mut'): Statement | null {
    const kwTok = this.advance(); // consume 'fix' or 'mut'

    const nameTok = this.peek();
    if (nameTok.kind !== 'SLOT') {
      this.errorMarkers.push({ code: 'S0003', span: nameTok.span });
      return null;
    }
    this.advance(); // consume slot name

    let typeAnnotation: TypeExpr | null = null;
    if (this.peek().kind === 'COLON') {
      this.advance(); // consume ':'
      typeAnnotation = this.parseTypeExpr();
      if (typeAnnotation === null) return null;
    }

    if (this.expect('EQUALS', 'S0004') === null) return null;

    const init = this.parseExpr();
    if (init === null) {
      return null;
    }

    return {
      kind,
      name: nameTok.value,
      typeAnnotation,
      init,
      span: { start: kwTok.span.start, end: init.span.end },
    };
  }

  // 'name = expr;' — reassigns a slot already declared with 'fix' or
  // 'mut'. Whether that's actually allowed (the slot must be 'mut') is
  // a name-binding rule, not a grammar rule, so it's checked at
  // evaluation time (interpreter.ts), not here.
  private parseAssign(): Statement | null {
    const nameTok = this.advance(); // consume slot name
    this.advance(); // consume '='

    const value = this.parseExpr();
    if (value === null) {
      return null;
    }

    return {
      kind: 'assign',
      name: nameTok.value,
      value,
      span: { start: nameTok.span.start, end: value.span.end },
    };
  }

  private parseStmt(): Statement | null {
    if (this.peek().kind === 'KW_FIX') {
      return this.parseDecl('fix');
    }
    if (this.peek().kind === 'KW_MUT') {
      return this.parseDecl('mut');
    }
    if (this.peek().kind === 'KW_WHILE') {
      return this.parseWhile();
    }
    if (this.peek().kind === 'SLOT' && this.peekNext().kind === 'EQUALS') {
      return this.parseAssign();
    }

    const expr = this.parseExpr();
    if (expr === null) {
      return null;
    }
    return { kind: 'expr', expr, span: expr.span };
  }

  // 'name: Type' — one entry in an args declaration.
  private parseArgDef(): ArgDef | null {
    const nameTok = this.peek();
    if (nameTok.kind !== 'SLOT') {
      this.errorMarkers.push({ code: 'S0003', span: nameTok.span });
      return null;
    }
    this.advance(); // consume name

    if (this.expect('COLON', 'S0009') === null) return null;

    const typeTok = this.peek();
    if (typeTok.kind !== 'TYPE_NAME') {
      this.errorMarkers.push({ code: 'S0010', span: typeTok.span });
      return null;
    }
    this.advance(); // consume type name

    return { name: nameTok.value, type: typeTok.value as ArgType };
  }

  // 'args (name: Type, …)' — the program's typed input declaration.
  private parseArgs(): ArgDef[] | null {
    this.advance(); // consume 'args'

    if (this.expect('LPAREN', 'S0006') === null) return null;

    const parsed = this.parseSeparated(() => this.parseArgDef(), 'COMMA', 'RPAREN', 'S0001');
    if (parsed === null) return null;

    return parsed.items;
  }

  private parseProgram(): Program | null {
    let args: ArgDef[] = [];
    if (this.peek().kind === 'KW_ARGS') {
      const result = this.parseArgs();
      if (result === null) return null;
      args = result;

      if (this.expect('SEMICOLON', 'S0011') === null) return null;
    }

    const parsed = this.parseSeparated(() => this.parseStmt(), 'SEMICOLON', 'EOF', 'S0011', true);
    if (parsed === null) return null;

    return { args, stmts: parsed.items };
  }

  public parse(): ParseResult {
    const program = this.parseProgram();
    return { program, errorMarkers: this.errorMarkers };
  }
}
