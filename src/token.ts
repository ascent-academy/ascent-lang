import type { Span } from './errors/marker.js';

export type TokenKind =
  | 'INT_LIT'    // a sequence of decimal digits: 0, 42, 1000
  | 'FLOAT_LIT'  // a decimal number with a dot: 0.5, 3.14, 1.0
  | 'STR_LIT'    // a double-quoted string: "hello"
  | 'BOOL_LIT'   // True or False
  | 'NONE_LIT'   // None
  | 'DONE_LIT'   // Done — the unit constructor
  | 'SLOT'       // a lowercase-starting identifier — a binding name
  | 'PLUS'       // '+'
  | 'MINUS'      // '-'
  | 'STAR'       // '*'
  | 'SLASH'      // '/', always real division — yields a Float
  | 'KW_DIV'     // the keyword div — Int-only floor division
  | 'KW_MOD'     // the keyword mod — Int-only floored modulo
  | 'KW_FIX'     // the keyword fix — declares a fixed slot
  | 'KW_MUT'     // the keyword mut — declares a mutable slot
  | 'KW_IF'      // the keyword if — starts a conditional expression
  | 'KW_ELSE'    // the keyword else — the alternative branch of an if
  | 'KW_WHILE'   // the keyword while — starts a condition loop
  | 'KW_ARGS'    // the keyword args — declares the program's typed inputs
  | 'TYPE_NAME'  // a built-in type name: Int, Float, Bool, String
  | 'COLON'      // ':' — separates a name from its type annotation
  | 'EQUALS'     // '=' — used in slot declarations and updates
  | 'EQ_EQ'      // '==' — structural equality
  | 'BANG_EQ'    // '!=' — structural inequality
  | 'LT'         // '<'
  | 'LT_EQ'      // '<='
  | 'GT'         // '>'
  | 'GT_EQ'      // '>='
  | 'DOT'        // '.' — method call operator
  | 'COMMA'      // ','
  | 'SEMICOLON'  // ';' — statement terminator
  | 'LPAREN'     // '('
  | 'RPAREN'     // ')'
  | 'LBRACE'     // '{'
  | 'RBRACE'     // '}'
  | 'ERROR'      // a character or run the lexer couldn't recognise
  | 'EOF';       // the sentinel that marks the end of source

export interface Token {
  kind: TokenKind;
  value: string;
  span: Span;
}
