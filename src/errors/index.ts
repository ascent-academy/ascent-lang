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
    "summary": "A name was used before it was created with 'fix' or 'mut'.",
    "message": "I can't find anything named '{found}'.",
    "explanation": "In Ascent a name has to be created before it's used, with 'fix' (a value that never changes) or 'mut' (one you can update later). Check that '{found}' is spelled the same as where you created it, or create it before this line."
  },
  {
    "code": "N0002",
    "name": "reassign-fix",
    "category": "name",
    "summary": "Assignment to a name created with 'fix', whose value never changes.",
    "message": "'{found}' was created with 'fix', so its value can't change.",
    "explanation": "A name created with 'fix' keeps its first value for good — that's what 'fix' means. If '{found}' needs to hold different values over time, create it with 'mut' instead of 'fix' where it was first made.",
    "related": [
      {
        "key": "declaration",
        "label": "'{found}' was created with 'fix' here"
      }
    ]
  },
  {
    "code": "N0003",
    "name": "assign-to-undeclared",
    "category": "name",
    "summary": "Assignment to a name that was never created with 'fix' or 'mut'.",
    "message": "I can't find a name '{found}' to assign to.",
    "explanation": "'=' changes the value of a name that already exists. To create '{found}' and give it a value at the same time, write 'mut {found} = …' (for a value you'll change later) or 'fix {found} = …' (for one that won't). If '{found}' should already exist, check the spelling."
  },
  {
    "code": "N0004",
    "name": "assign-to-arg",
    "category": "name",
    "summary": "Assignment to a program input, which is fixed for the whole run.",
    "message": "'{found}' is a program input, so its value can't change.",
    "explanation": "'{found}' comes from the program's 'args' — it's set once when the program starts and stays the same for the whole run, so it can't be assigned to. To work with a value you can update, make a new name with 'mut' and start it from '{found}', like 'mut total = {found};'."
  },
  {
    "code": "S0001",
    "name": "unclosed-paren",
    "category": "syntactic",
    "summary": "An opening '(' has no matching ')'.",
    "message": "I expected a ')' here.",
    "explanation": "Every '(' has to be closed with a matching ')'. One was opened earlier — around a group like '(a + b)', a call's inputs, or an 'if' or 'while' condition — and this is where its ')' should be.",
    "related": [
      {
        "key": "opener",
        "label": "this '(' was opened here"
      }
    ]
  },
  {
    "code": "S0002",
    "name": "expected-expression",
    "category": "syntactic",
    "summary": "A value was expected here, but there wasn't one.",
    "message": "I expected a value here.",
    "explanation": "This spot needs a value — a number, a String, a name, or something built from them like 'a + b'. Places that need one include just after '=', just after an operator like '+', and inside '( )'."
  },
  {
    "code": "S0003",
    "name": "expected-slot-name",
    "category": "syntactic",
    "summary": "A name was expected after 'fix' or 'mut', or as a program input.",
    "message": "I expected a name here.",
    "explanation": "A name is needed here — after 'fix' or 'mut' to create one ('fix count = 0'), or as the name of a program input ('args (age: Int)'). A name starts with a lowercase letter."
  },
  {
    "code": "S0004",
    "name": "expected-equals",
    "category": "syntactic",
    "summary": "An '=' was expected after the name in a 'fix' or 'mut' declaration.",
    "message": "I expected an '=' here.",
    "explanation": "'fix' and 'mut' give a name its starting value, so the name is followed by '=' and the value, like 'fix count = 0'. (A type can go in between, as in 'fix count: Int = 0'.)"
  },
  {
    "code": "S0005",
    "name": "unclosed-brace",
    "category": "syntactic",
    "summary": "An opening '{' has no matching '}'.",
    "message": "I expected a '}' here.",
    "explanation": "A block groups statements between '{' and '}'. One was opened earlier and this is where its closing '}' should be.",
    "related": [
      {
        "key": "opener",
        "label": "this '{' was opened here"
      }
    ]
  },
  {
    "code": "S0006",
    "name": "expected-test-paren",
    "category": "syntactic",
    "summary": "A '(' was expected to open a condition or an 'args' list.",
    "message": "I expected a '(' here.",
    "explanation": "An 'if' or 'while' condition — and the inputs listed after 'args' — go inside '( )', like 'if (age >= 18) { … }'. This is where that opening '(' should be."
  },
  {
    "code": "S0007",
    "name": "expected-block",
    "category": "syntactic",
    "summary": "A block ('{ … }') was expected here.",
    "message": "I expected a '{' here.",
    "explanation": "The body of an 'if', 'else', or 'while' is always a block between '{' and '}', even when it holds a single line, as in 'if (ok) { … }'."
  },
  {
    "code": "S0008",
    "name": "chained-comparison",
    "category": "syntactic",
    "summary": "Comparisons can't be chained — 'a < b < c' isn't allowed.",
    "message": "I can't chain two comparisons like this.",
    "explanation": "A comparison such as '<' or '==' looks at two values and gives back True or False. Chaining a third one, as in 'a < b < c', would then compare that True or False against another value, which has no clear meaning — so compare two values at a time."
  },
  {
    "code": "S0009",
    "name": "expected-colon",
    "category": "syntactic",
    "summary": "A ':' was expected between a program input's name and its type.",
    "message": "I expected a ':' here.",
    "explanation": "Each program input is written as a name, then ':', then its type, like 'args (age: Int)'. This is where the ':' should be."
  },
  {
    "code": "S0010",
    "name": "expected-type",
    "category": "syntactic",
    "summary": "A type name was expected here.",
    "message": "I expected a type name here.",
    "explanation": "A type name says what kind of value this is. The built-in types are Int, Float, Bool, and String, plus 'List<…>' for a list, as in 'List<Int>'."
  },
  {
    "code": "S0011",
    "name": "expected-semicolon",
    "category": "syntactic",
    "summary": "A ';' was expected to end the statement.",
    "message": "I expected a ';' here.",
    "explanation": "Every statement in Ascent ends with a ';'. It looks like the statement before this point was never finished with one."
  },
  {
    "code": "S0012",
    "name": "expected-method-name",
    "category": "syntactic",
    "summary": "A method name was expected after '.'.",
    "message": "I expected a method name here.",
    "explanation": "A '.' calls a method on a value, so it's followed by the method's name and '( )', like 'items.length()'. A method name starts with a lowercase letter."
  },
  {
    "code": "S0013",
    "name": "unclosed-bracket",
    "category": "syntactic",
    "summary": "An opening '[' has no matching ']'.",
    "message": "I expected a ']' here.",
    "explanation": "Square brackets '[ ]' wrap a list like '[1, 2, 3]' or pick an item out of one like 'items[0]'. One '[' was opened earlier and this is where its ']' should be.",
    "related": [
      {
        "key": "opener",
        "label": "this '[' was opened here"
      }
    ]
  },
  {
    "code": "S0014",
    "name": "expected-call-paren",
    "category": "syntactic",
    "summary": "A method call needs '( )' after the method name.",
    "message": "I expected a '(' here.",
    "explanation": "A '.' calls a method, and a call always has '( )' after the name — even when the method takes no inputs, as in 'items.length()'. This is where that opening '(' should be."
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
