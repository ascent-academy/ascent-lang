export type TokenKind =
  | 'INT_LIT'        // a sequence of decimal digits: 0, 42, 1000
  | 'FLOAT_LIT'      // a decimal number with a dot: 0.5, 3.14, 1.0
  | 'STR_PART'       // a chunk of string text immediately followed by '${' — an interpolation hole comes next
  | 'STR_PART_END'   // a chunk of string text that runs to the closing '"' — the string ends here
  | 'MSTR_PART'      // like STR_PART, but inside a multiline """..."""  string — raw, undedented text
  | 'MSTR_PART_END'  // like STR_PART_END, but for """..."""  — carries `margin` (see Token below)
  | 'BOOL_LIT'       // True or False
  | 'NONE_LIT'       // None
  | 'DONE_LIT'       // Done — the unit constructor
  | 'SLOT'           // a lowercase-starting identifier — a binding name
  | 'PLUS'           // '+' — addition operator
  | 'MINUS'          // '-' — subtraction operator
  | 'STAR'           // '*' — multiplication operator
  | 'STAR_STAR'      // '**' — raises the left operand to the right operand's power
  | 'SLASH'          // '/', always real division — yields a Float
  | 'KW_DIV'         // the keyword div — Int-only floor division
  | 'KW_MOD'         // the keyword mod — Int-only floored modulo
  | 'KW_AND'         // the keyword and — Bool-only logical and, short-circuits
  | 'KW_OR'          // the keyword or — Bool-only logical or, short-circuits
  | 'KW_NOT'         // the keyword not — Bool-only prefix negation
  | 'KW_FIX'         // the keyword fix — declares a fixed slot
  | 'KW_MUT'         // the keyword mut — declares a mutable slot
  | 'KW_IF'          // the keyword if — starts a conditional expression
  | 'KW_ELSE'        // the keyword else — the alternative branch of an if
  | 'KW_WHILE'       // the keyword while — starts a condition loop
  | 'KW_FOR'         // the keyword for — starts a value-iterating loop
  | 'KW_IN'          // the keyword in — separates a for loop's variable from what it iterates
  | 'KW_PROGRAM'     // the keyword program — wraps the entry point and its typed inputs
  | 'KW_TYPE'        // the keyword type — declares a user-defined type
  | 'KW_VOID'        // the keyword void — evaluates an expression and discards its value
  | 'KW_MATCH'       // the keyword match — starts a pattern-matching expression
  | 'KW_FN'          // the keyword fn — introduces a function value (a 'Fn(...)-> R' type uses the capitalized name)
  | 'KW_RETURN'      // the keyword return — early-exits the enclosing function
  | 'KW_ABORT'       // the keyword abort — diverges with a reason ('abort "…"'), type Never
  | 'KW_ORFAIL'      // the keyword orfail — the 'T orfail E' Result type operator
  | 'KW_TRY'         // the keyword try — unwrap-or-propagate an Optional/Result
  | 'KW_WITH'        // the keyword with — 'base with field = value', an updated copy of a record
  | 'KW_ASYNC'       // the keyword async — marks a function whose call prepares a Task ('async fn(...)')
  | 'KW_AWAIT'       // the keyword await — starts and waits on a Task, yielding its value
  | 'KW_IMPORT'      // the keyword import — brings stdlib module exports into scope ('import { … } from "…"')
  | 'KW_FROM'        // the keyword from — separates an import's names from its module specifier
  | 'TYPE_NAME'      // an UpperCamel identifier — a type name or record constructor (Int, Person)
  | 'COLON'          // ':' — separates a name from its type annotation
  | 'EQUALS'         // '=' — used in slot declarations and updates
  | 'EQ_EQ'          // '==' — structural equality
  | 'BANG_EQ'        // '!=' — structural inequality
  | 'BANG'           // '!' — the async-call mark: 'fetchUser!(id)' prepares an inert Task
  | 'LT'             // '<' — less than
  | 'LT_EQ'          // '<=' — less than or equal to
  | 'GT'             // '>' — greater than
  | 'GT_EQ'          // '>=' — greater than or equal to
  | 'ARROW'          // '->' — separates a 'match' arm's pattern from its result, and a 'Fn(...) -> R' type's result
  | 'FAT_ARROW'      // '=>' — introduces a function's single-expression body ('fn(x): Int => e')
  | 'DOT'            // '.' — method call operator
  | 'DOTDOT'         // '..' — the half-open range operator, as in '0..n'
  | 'COMMA'          // ',' — separates items in a list or arguments in a function call
  | 'SEMICOLON'      // ';' — statement terminator
  | 'LPAREN'         // '(' — open parenthesis
  | 'RPAREN'         // ')' — close parenthesis
  | 'LBRACE'         // '{' — open brace
  | 'RBRACE'         // '}' — close brace
  | 'LBRACKET'       // '[' — list literal open / index open
  | 'RBRACKET'       // ']' — list literal close / index close
  | 'QUESTION'       // '?' — the Optional<T> suffix in a type annotation, e.g. 'String?'
  | 'QUESTION_QUESTION' // '??' — the Optional default operator, as in 'nick ?? "anon"'
  | 'PIPE'           // '|' — separates the variants of a tagged-union 'type'
  | 'WHITESPACE'     // a run of spaces/tabs/newlines — trivia (TokenStream filters it out)
  | 'LINE_COMMENT'   // '# …' up to (not including) the end of the line — trivia
  | 'BLOCK_COMMENT'  // '#[ … ]#' (nests) — trivia
  | 'ERROR'          // a character or run the lexer couldn't recognise
  | 'EOF';           // the sentinel that marks the end of source

const TRIVIA_KINDS: ReadonlySet<TokenKind> = new Set(['WHITESPACE', 'LINE_COMMENT', 'BLOCK_COMMENT']);

export const isTrivia = (kind: TokenKind): boolean => TRIVIA_KINDS.has(kind);

export type SyntaxClass =
  | 'keyword'
  | 'type'
  | 'literal'
  | 'punctuation'
  | 'comment'
  | 'plain'
  | 'error';

const SYNTAX_CLASSES: Record<TokenKind, SyntaxClass | null> = {
  INT_LIT: 'literal',
  FLOAT_LIT: 'literal',
  STR_PART: 'literal',
  STR_PART_END: 'literal',
  MSTR_PART: 'literal',
  MSTR_PART_END: 'literal',
  BOOL_LIT: 'type',
  NONE_LIT: 'type',
  DONE_LIT: 'type',
  SLOT: 'plain',
  PLUS: 'punctuation',
  MINUS: 'punctuation',
  STAR: 'punctuation',
  STAR_STAR: 'punctuation',
  SLASH: 'punctuation',
  KW_DIV: 'keyword',
  KW_MOD: 'keyword',
  KW_AND: 'keyword',
  KW_OR: 'keyword',
  KW_NOT: 'keyword',
  KW_FIX: 'keyword',
  KW_MUT: 'keyword',
  KW_IF: 'keyword',
  KW_ELSE: 'keyword',
  KW_WHILE: 'keyword',
  KW_FOR: 'keyword',
  KW_IN: 'keyword',
  KW_PROGRAM: 'keyword',
  KW_TYPE: 'keyword',
  KW_VOID: 'keyword',
  KW_MATCH: 'keyword',
  KW_FN: 'keyword',
  KW_RETURN: 'keyword',
  KW_ABORT: 'keyword',
  KW_ORFAIL: 'keyword',
  KW_TRY: 'keyword',
  KW_WITH: 'keyword',
  KW_ASYNC: 'keyword',
  KW_AWAIT: 'keyword',
  KW_IMPORT: 'keyword',
  KW_FROM: 'keyword',
  TYPE_NAME: 'type',
  COLON: 'punctuation',
  EQUALS: 'punctuation',
  EQ_EQ: 'punctuation',
  BANG_EQ: 'punctuation',
  BANG: 'punctuation',
  LT: 'punctuation',
  LT_EQ: 'punctuation',
  GT: 'punctuation',
  GT_EQ: 'punctuation',
  ARROW: 'punctuation',
  FAT_ARROW: 'punctuation',
  DOT: 'punctuation',
  DOTDOT: 'punctuation',
  COMMA: 'punctuation',
  SEMICOLON: 'punctuation',
  LPAREN: 'punctuation',
  RPAREN: 'punctuation',
  LBRACE: 'punctuation',
  RBRACE: 'punctuation',
  LBRACKET: 'punctuation',
  RBRACKET: 'punctuation',
  QUESTION: 'punctuation',
  QUESTION_QUESTION: 'punctuation',
  PIPE: 'punctuation',
  WHITESPACE: null,
  LINE_COMMENT: 'comment',
  BLOCK_COMMENT: 'comment',
  ERROR: 'error',
  EOF: null,
};

export const syntaxClass = (kind: TokenKind): SyntaxClass | null => SYNTAX_CLASSES[kind];

export interface Position {
  offset: number;  // 0-based index into the source string
  line: number;    // 1-based
  column: number;  // 1-based
}

export interface Span {
  start: Position;
  end: Position;   // exclusive — points one past the last character
}

// A supporting span a stage attaches to a marker — e.g. the earlier
// declaration a "can't reassign" error refers back to. `key` names the span's
// role; the matching label (prose) lives in the error's .yml row, keyed the
// same way, so no stage holds a user-facing sentence.
export interface RelatedMarker {
  key: string;
  span: Span;
}

export interface Marker {
  code: string;
  span: Span;
  related?: RelatedMarker[];
  // Named values a stage knows but the source can't reconstruct — chiefly the
  // type names in a type error ('Int', 'String'). Interpolated into the
  // message/explanation as {key}. Kept as strings so the checker never holds a
  // sentence, only the words that fill the blanks.
  data?: Record<string, string>;
}

export interface Token {
  kind: TokenKind;
  // The token's semantic content — what the parser reads. For most tokens this
  // is identical to `text`, but for string parts it's the *decoded* value
  // (escapes resolved, delimiters/'${' dropped) while `text` stays raw.
  value: string;
  // The exact source characters this token spans, trivia and delimiters
  // included. The lexer is lossless: concatenating every token's `text` in
  // order reconstructs the source 1:1 (see Lexer.tokenize). `value` may differ
  // (decoded strings); `text` never does.
  text: string;
  span: Span;
  // Only set on MSTR_PART_END: the column of the closing '"""' — how many
  // characters precede it on its own line, and so how many leading
  // characters to dedent from every line of the string
  dedentMargin?: number;
}
