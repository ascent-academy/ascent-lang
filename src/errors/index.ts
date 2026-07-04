// AUTO-GENERATED — do not edit. Run `npm run generate` to update.

import type { ErrorEntry } from './types.js';

export const ERRORS: ErrorEntry[] = [
  {
    "code": "L0001",
    "name": "unexpected-character",
    "category": "lexical",
    "summary": "A character that isn't part of Ascent.",
    "message": "I don't recognise '{found}' here.",
    "explanation": "Ascent is built from letters, digits, and a small set of symbols like + - * / ( ) { } = . This character isn't one of them.",
    "variants": [
      {
        "when": {
          "equals": "!"
        },
        "explanation": "Ascent doesn't use '!' on its own. It writes \"is not equal to\" as '!=', and flips a True / False value with the word 'not'."
      },
      {
        "when": {
          "equals": "?"
        },
        "explanation": "Ascent doesn't use '?' on its own. It uses '??' to supply a fallback value when something is None."
      }
    ]
  },
  {
    "code": "L0002",
    "name": "invalid-number-literal",
    "category": "lexical",
    "summary": "A number with letters attached, like '123abc'.",
    "message": "I can't read '{found}' as a number.",
    "explanation": "A number in Ascent is made of digits, with an optional '.' for a decimal — like 42 or 3.14. This one has letters joined onto it, so it isn't a number.",
    "example": {
      "valid": "42",
      "invalid": "123abc"
    }
  },
  {
    "code": "L0003",
    "name": "unterminated-string",
    "category": "lexical",
    "summary": "A String with no closing \".",
    "message": "This String is missing its closing \".",
    "explanation": "Every String begins and ends with a \". This one has an opening \" but the line ends before a matching \" appears."
  },
  {
    "code": "L0004",
    "name": "missing-integer-part",
    "category": "lexical",
    "summary": "A decimal with no digit before the '.', like '.5'.",
    "message": "This number needs a digit before the '.'.",
    "explanation": "In Ascent a decimal needs a digit on both sides of the '.'. '{found}' has nothing before the '.', so it isn't complete.",
    "fix": {
      "title": "Write '0{found}'",
      "replacement": "0{found}"
    },
    "example": {
      "valid": "0.5",
      "invalid": ".5"
    }
  },
  {
    "code": "N0001",
    "name": "undefined-slot",
    "category": "name",
    "summary": "A name was used that has not been declared with 'fix' or 'mut'."
  },
  {
    "code": "N0002",
    "name": "reassign-fix",
    "category": "name",
    "summary": "Assignment to a slot declared with 'fix' — 'fix' slots never change; declare it with 'mut' instead if it needs to."
  },
  {
    "code": "S0001",
    "name": "unclosed-paren",
    "category": "syntactic",
    "summary": "An opening '(' has no matching ')'."
  },
  {
    "code": "S0002",
    "name": "expected-expression",
    "category": "syntactic",
    "summary": "An expression was required here but the input contained none."
  },
  {
    "code": "S0003",
    "name": "expected-slot-name",
    "category": "syntactic",
    "summary": "A slot name (lowercase identifier) was expected after 'fix'."
  },
  {
    "code": "S0004",
    "name": "expected-equals",
    "category": "syntactic",
    "summary": "An '=' was expected after the slot name in a 'fix' declaration."
  },
  {
    "code": "S0005",
    "name": "unclosed-brace",
    "category": "syntactic",
    "summary": "An opening '{' has no matching '}'."
  },
  {
    "code": "S0006",
    "name": "expected-test-paren",
    "category": "syntactic",
    "summary": "An '(' was expected here to start the condition."
  },
  {
    "code": "S0007",
    "name": "expected-block",
    "category": "syntactic",
    "summary": "A block ('{ … }') was expected here."
  },
  {
    "code": "S0008",
    "name": "chained-comparison",
    "category": "syntactic",
    "summary": "Comparisons don't chain — 'a < b < c' isn't valid. Group with parentheses instead."
  },
  {
    "code": "S0009",
    "name": "expected-colon",
    "category": "syntactic",
    "summary": "A ':' was expected between the argument name and its type."
  },
  {
    "code": "S0010",
    "name": "expected-type",
    "category": "syntactic",
    "summary": "A type name was expected here. Valid types are Int, Float, Bool, String, and List<T>."
  },
  {
    "code": "S0011",
    "name": "expected-semicolon",
    "category": "syntactic",
    "summary": "A ';' was expected here."
  },
  {
    "code": "S0012",
    "name": "expected-method-name",
    "category": "syntactic",
    "summary": "A method name (lowercase identifier) was expected after '.'."
  },
  {
    "code": "S0013",
    "name": "unclosed-bracket",
    "category": "syntactic",
    "summary": "An opening '[' has no matching ']'."
  },
  {
    "code": "T0001",
    "name": "annotation-mismatch",
    "category": "type",
    "summary": "The declared type annotation doesn't match the inferred type of the initialiser."
  },
  {
    "code": "T0002",
    "name": "incompatible-list-elements",
    "category": "type",
    "summary": "List elements have incompatible types — a list must be homogeneous (all the same type, with Int widening to Float)."
  },
  {
    "code": "T0003",
    "name": "empty-list-needs-annotation",
    "category": "type",
    "summary": "An empty list '[]' has no element type. Annotate the variable: 'fix xs: List<Int> = []'."
  },
  {
    "code": "T0004",
    "name": "condition-not-bool",
    "category": "type",
    "summary": "The condition in 'if' or 'while' must be of type Bool."
  },
  {
    "code": "T0005",
    "name": "if-branch-mismatch",
    "category": "type",
    "summary": "The 'then' and 'else' branches of 'if' have incompatible types."
  },
  {
    "code": "T0006",
    "name": "no-such-method",
    "category": "type",
    "summary": "The type has no method with this name."
  },
  {
    "code": "T0007",
    "name": "wrong-arg-count",
    "category": "type",
    "summary": "Wrong number of arguments for this method or function call."
  },
  {
    "code": "T0008",
    "name": "wrong-arg-type",
    "category": "type",
    "summary": "An argument has the wrong type for this method or function call."
  },
  {
    "code": "T0009",
    "name": "operator-type-error",
    "category": "type",
    "summary": "An operator was applied to operands of incompatible types."
  },
  {
    "code": "T0010",
    "name": "index-requires-list",
    "category": "type",
    "summary": "The '[ ]' index operator requires a List, but the receiver has a different type."
  },
  {
    "code": "T0011",
    "name": "index-not-int",
    "category": "type",
    "summary": "List indices must be of type Int."
  },
  {
    "code": "T0012",
    "name": "no-methods",
    "category": "type",
    "summary": "This type has no methods."
  }
];

export const byCode = new Map(ERRORS.map(e => [e.code, e]));
