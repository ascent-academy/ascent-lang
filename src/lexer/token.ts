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
  | 'KW_ARGS'        // the keyword args — declares the program's typed inputs
  | 'KW_TYPE'        // the keyword type — declares a user-defined type
  | 'KW_VOID'        // the keyword void — evaluates an expression and discards its value
  | 'KW_MATCH'       // the keyword match — starts a pattern-matching expression
  | 'TYPE_NAME'      // an UpperCamel identifier — a type name or record constructor (Int, Person)
  | 'COLON'          // ':' — separates a name from its type annotation
  | 'EQUALS'         // '=' — used in slot declarations and updates
  | 'EQ_EQ'          // '==' — structural equality
  | 'BANG_EQ'        // '!=' — structural inequality
  | 'LT'             // '<' — less than
  | 'LT_EQ'          // '<=' — less than or equal to
  | 'GT'             // '>' — greater than
  | 'GT_EQ'          // '>=' — greater than or equal to
  | 'ARROW'          // '->' — separates a 'match' arm's pattern from its result
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
  | 'PIPE'           // '|' — separates the variants of a tagged-union 'type'
  | 'ERROR'          // a character or run the lexer couldn't recognise
  | 'EOF';           // the sentinel that marks the end of source

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
  value: string;
  span: Span;
  // Only set on MSTR_PART_END: the column of the closing '"""' — how many
  // characters precede it on its own line, and so how many leading
  // characters to dedent from every line of the string
  dedentMargin?: number;
}
