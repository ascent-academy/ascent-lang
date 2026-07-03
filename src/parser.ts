import type { Token, TokenKind } from './token.js';
import type { ErrorMarker } from './errors/marker.js';
import type { Expr, Statement, Program, Block, If, BinaryOp, ArgDef, ArgType, TypeExpr } from './ast.js';

export interface ParseResult {
  program: Program | null;
  errorMarkers: ErrorMarker[];
}

export class Parser {
  private tokens: Token[];
  private pos: number = 0;
  private errorMarkers: ErrorMarker[] = [];

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

  // ---- Pratt parsing --------------------------------------------------
  //
  // A Pratt parser recognises an expression as an atom (a "nud" — null
  // denotation, a value that doesn't look left at anything) optionally
  // followed by a chain of infix operators (each a "led" — left
  // denotation, because it combines the value already parsed with
  // whatever comes after it).
  //
  // Every infix operator has a binding power: a number saying how
  // tightly it grabs its operands. Higher binds tighter — that's what
  // encodes precedence: '*' outbinds '+', so `1 + 2 * 3` parses as
  // `1 + (2 * 3)`, not `(1 + 2) * 3`. The parsing loop only accepts an
  // operator when its binding power is at least `minBp` — the "how
  // tight does the *caller* need things bound" threshold passed down on
  // each recursive call.
  //
  // Every operator this parser knows about has one row in this table.
  // Adding the next one (say '-') means adding a row, never touching
  // the loop below. '*', '/', 'div' and 'mod' all share a binding power
  // — they're the same precedence tier — so all four outbind '+', which
  // in turn outbinds the comparisons — `1 + 2 < 3 * 4` groups as
  // `(1 + 2) < (3 * 4)`. Comparisons are also marked `assoc: 'none'`:
  // unlike '+' or '*', two of them can never sit side by side
  // (`a < b < c` is rejected, not silently grouped one way or the other).
  private static readonly INFIX_OPS: Partial<Record<TokenKind, { op: BinaryOp; bp: number; assoc: 'left' | 'none' }>> = {
    EQ_EQ: { op: '==', bp: 1, assoc: 'none' },
    BANG_EQ: { op: '!=', bp: 1, assoc: 'none' },
    LT: { op: '<', bp: 1, assoc: 'none' },
    LT_EQ: { op: '<=', bp: 1, assoc: 'none' },
    GT: { op: '>', bp: 1, assoc: 'none' },
    GT_EQ: { op: '>=', bp: 1, assoc: 'none' },
    PLUS: { op: '+', bp: 2, assoc: 'left' },
    MINUS: { op: '-', bp: 2, assoc: 'left' },
    STAR: { op: '*', bp: 3, assoc: 'left' },
    SLASH: { op: '/', bp: 3, assoc: 'left' },
    KW_DIV: { op: 'div', bp: 3, assoc: 'left' },
    KW_MOD: { op: 'mod', bp: 3, assoc: 'left' },
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
      // Method call: expr.method(args) — DOT binds tighter than any binary op.
      if (this.peek().kind === 'DOT') {
        const DOT_BP = 4;
        if (DOT_BP < minBp) break;
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

        const args: Expr[] = [];
        if (this.peek().kind !== 'RPAREN') {
          const first = this.parseExpr();
          if (first === null) return null;
          args.push(first);

          while (this.peek().kind === 'COMMA') {
            this.advance(); // consume ','
            const arg = this.parseExpr();
            if (arg === null) return null;
            args.push(arg);
          }
        }

        const rparen = this.peek();
        if (rparen.kind !== 'RPAREN') {
          this.errorMarkers.push({ code: 'S0001', span: rparen.span });
          return null;
        }
        this.advance(); // consume ')'

        left = {
          kind: 'methodCall',
          receiver: left,
          method: methodTok.value,
          args,
          span: { start: left.span.start, end: rparen.span.end },
        };
        continue;
      }

      // Index access: expr[index] — same binding power as method calls.
      if (this.peek().kind === 'LBRACKET') {
        const INDEX_BP = 4;
        if (INDEX_BP < minBp) break;
        this.advance(); // consume '['

        const index = this.parseExpr();
        if (index === null) return null;

        const rbracket = this.peek();
        if (rbracket.kind !== 'RBRACKET') {
          this.errorMarkers.push({ code: 'S0013', span: rbracket.span });
          return null;
        }
        this.advance(); // consume ']'

        left = {
          kind: 'index',
          list: left,
          index,
          span: { start: left.span.start, end: rbracket.span.end },
        };
        continue;
      }

      const infix = Parser.INFIX_OPS[this.peek().kind];
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
        type: 'Int',
        value: BigInt(tok.value),
        span: tok.span
      };
    }

    if (tok.kind === 'FLOAT_LIT') {
      this.advance();
      return {
        kind: 'literal',
        type: 'Float',
        value: parseFloat(tok.value),
        span: tok.span
      };
    }

    if (tok.kind === 'STR_LIT') {
      this.advance();
      return { kind: 'literal', type: 'String', value: tok.value, span: tok.span };
    }

    if (tok.kind === 'BOOL_LIT') {
      this.advance();
      return {
        kind: 'literal',
        type: 'Bool',
        value: tok.value === 'True',
        span: tok.span
      };
    }

    if (tok.kind === 'NONE_LIT') {
      this.advance();
      return { kind: 'literal', type: 'None', span: tok.span };
    }

    if (tok.kind === 'DONE_LIT') {
      this.advance();
      return { kind: 'literal', type: 'Done', span: tok.span };
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

    if (tok.kind === 'MINUS') {
      const start = tok.span.start;
      this.advance();
      const operand = this.parseExpr(4); // bp 4 > any binary op, so unary binds tightest
      if (operand === null) {
        return null;
      }
      return { kind: 'unary', op: '-', operand, span: { start, end: operand.span.end } };
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
    const args: Expr[] = [];

    if (this.peek().kind !== 'RPAREN') {
      const first = this.parseExpr();
      if (first === null) return null;
      args.push(first);

      while (this.peek().kind === 'COMMA') {
        this.advance(); // consume ','
        const arg = this.parseExpr();
        if (arg === null) return null;
        args.push(arg);
      }
    }

    const rparen = this.peek();
    if (rparen.kind !== 'RPAREN') {
      this.errorMarkers.push({ code: 'S0001', span: rparen.span });
      return null;
    }
    this.advance(); // consume ')'

    return {
      kind: 'call',
      callee: callee.value,
      args,
      span: { start: callee.span.start, end: rparen.span.end },
    };
  }

  // '[' expr, expr, … ']' — list literal. Already consumed '[' in parseAtom.
  private parseList(): Expr | null {
    const openTok = this.advance(); // consume '['
    const elements: Expr[] = [];

    if (this.peek().kind !== 'RBRACKET') {
      const first = this.parseExpr();
      if (first === null) return null;
      elements.push(first);

      while (this.peek().kind === 'COMMA') {
        this.advance(); // consume ','
        if (this.peek().kind === 'RBRACKET') break; // trailing comma
        const el = this.parseExpr();
        if (el === null) return null;
        elements.push(el);
      }
    }

    const closeTok = this.peek();
    if (closeTok.kind !== 'RBRACKET') {
      this.errorMarkers.push({ code: 'S0013', span: closeTok.span });
      return null;
    }
    this.advance(); // consume ']'

    return { kind: 'list', elements, span: { start: openTok.span.start, end: closeTok.span.end } };
  }

  // A block is '{' stmt* '}' — every statement inside follows the same
  // rules as top-level statements (parseStmt), just bounded by '}'
  // instead of EOF.
  private parseBlock(): Block | null {
    const openTok = this.advance(); // consume '{'
    const stmts: Statement[] = [];

    while (this.peek().kind !== 'RBRACE') {
      if (this.peek().kind === 'EOF') {
        this.errorMarkers.push({ code: 'S0005', span: this.peek().span });
        return null;
      }
      // Skip any stray semicolons between statements.
      if (this.peek().kind === 'SEMICOLON') {
        this.advance();
        continue;
      }

      const stmt = this.parseStmt();
      if (stmt === null) {
        return null;
      }
      stmts.push(stmt);

      // Consume the optional trailing semicolon.
      if (this.peek().kind === 'SEMICOLON') {
        this.advance();
      }
    }

    const closeTok = this.advance(); // consume '}'
    return { kind: 'block', stmts, span: { start: openTok.span.start, end: closeTok.span.end } };
  }

  // The parenthesized test shared by 'if' and 'while' — '(' expr ')'.
  // The body braces already delimit the construct, but the test stays
  // parenthesized to match the C-family/TS surface (§5).
  private parseCond(): Expr | null {
    const lparen = this.peek();
    if (lparen.kind !== 'LPAREN') {
      this.errorMarkers.push({ code: 'S0006', span: lparen.span });
      return null;
    }
    this.advance(); // consume '('

    const cond = this.parseExpr();
    if (cond === null) {
      return null;
    }

    const rparen = this.peek();
    if (rparen.kind !== 'RPAREN') {
      this.errorMarkers.push({ code: 'S0001', span: rparen.span });
      return null;
    }
    this.advance(); // consume ')'

    return cond;
  }

  // A mandatory body block — every 'if'/'while' branch needs one, even
  // single-statement (§2: no dangling-else, no goto-fail class of bug).
  private parseRequiredBlock(): Block | null {
    if (this.peek().kind !== 'LBRACE') {
      this.errorMarkers.push({ code: 'S0007', span: this.peek().span });
      return null;
    }
    return this.parseBlock();
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
      const lt = this.peek();
      if (lt.kind !== 'LT') {
        this.errorMarkers.push({ code: 'S0010', span: lt.span });
        return null;
      }
      this.advance(); // consume '<'

      const elem = this.parseTypeExpr();
      if (elem === null) return null;

      const gt = this.peek();
      if (gt.kind !== 'GT') {
        this.errorMarkers.push({ code: 'S0010', span: gt.span });
        return null;
      }
      this.advance(); // consume '>'

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

    const eqTok = this.peek();
    if (eqTok.kind !== 'EQUALS') {
      this.errorMarkers.push({ code: 'S0004', span: eqTok.span });
      return null;
    }
    this.advance(); // consume '='

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

    const colon = this.peek();
    if (colon.kind !== 'COLON') {
      this.errorMarkers.push({ code: 'S0009', span: colon.span });
      return null;
    }
    this.advance(); // consume ':'

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

    const lparen = this.peek();
    if (lparen.kind !== 'LPAREN') {
      this.errorMarkers.push({ code: 'S0006', span: lparen.span });
      return null;
    }
    this.advance(); // consume '('

    const args: ArgDef[] = [];

    if (this.peek().kind !== 'RPAREN') {
      const first = this.parseArgDef();
      if (first === null) return null;
      args.push(first);

      while (this.peek().kind === 'COMMA') {
        this.advance(); // consume ','
        const arg = this.parseArgDef();
        if (arg === null) return null;
        args.push(arg);
      }
    }

    const rparen = this.peek();
    if (rparen.kind !== 'RPAREN') {
      this.errorMarkers.push({ code: 'S0001', span: rparen.span });
      return null;
    }
    this.advance(); // consume ')'

    return args;
  }

  private parseProgram(): Program | null {
    // Skip any leading semicolons before the optional args declaration.
    while (this.peek().kind === 'SEMICOLON') {
      this.advance();
    }

    let args: ArgDef[] = [];
    if (this.peek().kind === 'KW_ARGS') {
      const result = this.parseArgs();
      if (result === null) return null;
      args = result;

      const semi = this.peek();
      if (semi.kind !== 'SEMICOLON') {
        this.errorMarkers.push({ code: 'S0011', span: semi.span });
        return null;
      }
      this.advance(); // consume ';'
    }

    const stmts: Statement[] = [];

    while (this.peek().kind !== 'EOF') {
      // Skip any stray semicolons between statements.
      if (this.peek().kind === 'SEMICOLON') {
        this.advance();
        continue;
      }

      const stmt = this.parseStmt();
      if (stmt === null) {
        return null;
      }
      stmts.push(stmt);

      // Consume the optional trailing semicolon.
      if (this.peek().kind === 'SEMICOLON') {
        this.advance();
      }
    }

    return { args, stmts };
  }

  public parse(): ParseResult {
    const program = this.parseProgram();
    return { program, errorMarkers: this.errorMarkers };
  }
}
