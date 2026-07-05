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
    "code": "L0005",
    "name": "unterminated-block-comment",
    "category": "lexical",
    "summary": "A #[ block comment with no matching ]#.",
    "message": "This comment is missing its closing ]#.",
    "explanation": "A block comment begins with #[ and ends with ]#, and a #[ ... ]# comment can sit inside another one. This one has an opening #[ but the program ends before a matching ]# appears."
  },
  {
    "code": "L0006",
    "name": "unterminated-interpolation",
    "category": "lexical",
    "summary": "A ${ hole inside a String has no closing }.",
    "message": "This ${ is missing its closing }.",
    "explanation": "Inside a String, ${ starts a hole that puts a value into the text, and it needs a matching } to close it, like \"Hi ${name}\". This one has an opening ${ but the program ends before a matching } appears."
  },
  {
    "code": "L0007",
    "name": "unterminated-multiline-string",
    "category": "lexical",
    "summary": "A multiline String (\"\"\") with no closing \"\"\".",
    "message": "This multiline String is missing its closing \"\"\".",
    "explanation": "A multiline String begins and ends with \"\"\". This one has an opening \"\"\" but the program ends before a matching \"\"\" appears."
  },
  {
    "code": "L0008",
    "name": "insufficient-indentation",
    "category": "lexical",
    "summary": "A line in a multiline String has less indentation than its closing \"\"\".",
    "message": "This line doesn't have enough indentation to match the closing \"\"\".",
    "explanation": "In a multiline String, the closing \"\"\" sets how much leading space is shared by every line, and that much is removed from each one. This line starts further left than the closing \"\"\", so there isn't enough shared space to remove."
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
    "code": "R0001",
    "name": "int-overflow",
    "category": "runtime",
    "summary": "An Int calculation produced a result outside Int's 64-bit range.",
    "message": "'{found}' overflows Int.",
    "explanation": "Int holds a whole number in 64 bits, from -9223372036854775808 to 9223372036854775807. This calculation's result falls outside that range, so Ascent stops rather than silently wrapping it around to a different number. If the calculation genuinely needs to go this high, use Float instead."
  },
  {
    "code": "R0002",
    "name": "division-by-zero",
    "category": "runtime",
    "summary": "The right-hand side of '/', 'div', or 'mod' was zero.",
    "message": "'{found}' is zero, so I can't divide by it.",
    "explanation": "'/', 'div', and 'mod' all need a divisor that isn't zero — there's no number that answers \"divided by zero\". Check that '{found}' can't actually be zero here, or guard this line with an 'if'."
  },
  {
    "code": "R0003",
    "name": "negative-int-exponent",
    "category": "runtime",
    "summary": "Int ** Int was raised to a negative power, which needs a fractional result.",
    "message": "I can't raise an Int to the negative power '{found}'.",
    "explanation": "When both sides of '**' are Int, the result is always an Int — but a negative exponent needs a fractional answer, like 0.5, which an Int can't hold. Make the base a Float instead (for example '2.0 ** {found}') to get a Float result."
  },
  {
    "code": "R0004",
    "name": "non-finite-float",
    "category": "runtime",
    "summary": "A Float calculation produced Infinity or NaN, which aren't valid Float values.",
    "message": "'{found}' doesn't produce a real number.",
    "explanation": "Every Float in Ascent has to be a real, ordered number — Ascent never lets 'Infinity' or 'NaN' exist as a value. This calculation's result is either too large to represent or has no defined numeric answer, so it can't become a Float."
  },
  {
    "code": "R0005",
    "name": "index-out-of-bounds",
    "category": "runtime",
    "summary": "A list was indexed with '[ ]' outside its valid range.",
    "message": "'{found}' is out of range for this list.",
    "explanation": "A list index counts from 0, so a list with {length} item(s) has valid indexes from 0 up to (but not including) {length}. '{found}' falls outside that range."
  },
  {
    "code": "R0006",
    "name": "empty-string-access",
    "category": "runtime",
    "summary": "'.first()' or '.last()' was called on a String with no characters.",
    "message": "'.{method}()' has nothing to return: this String is empty.",
    "explanation": "'.first()' returns a String's first character and '.last()' its last, but an empty String (\"\") has neither. Check the String's '.length()' before calling '.{method}()' if it might be empty.",
    "retired": true
  },
  {
    "code": "R0007",
    "name": "string-slice-out-of-bounds",
    "category": "runtime",
    "summary": "'.slice(start, end)' had a start or end outside the String's valid range.",
    "message": "'.slice({start}, {end})' is out of range for this String.",
    "explanation": "'.slice(start, end)' counts characters from 0 and the end is exclusive, so a String with {length} character(s) only accepts a start and end between 0 and {length}, with start no greater than end. '{start}' and '{end}' don't fit that rule here."
  },
  {
    "code": "R0008",
    "name": "negative-repeat-count",
    "category": "runtime",
    "summary": "'.repeat(n)' was called with a negative n.",
    "message": "'.repeat({count})' can't repeat a String a negative number of times.",
    "explanation": "'.repeat(n)' builds a new String out of n copies of this one, so n has to be 0 or more — there's no such thing as repeating something a negative number of times. Use 0 if you want an empty String back."
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
    "code": "S0015",
    "name": "extra-interpolation-content",
    "category": "syntactic",
    "summary": "A '${ }' hole in a String holds more than one value.",
    "message": "I expected this '${ }' hole to end here.",
    "explanation": "A '${ }' hole inside a String holds exactly one value, like '${name}' or '${price.toString()}'. This one has extra content after a complete value, so it isn't clear what to do with it."
  },
  {
    "code": "T0001",
    "name": "annotation-mismatch",
    "category": "type",
    "summary": "A value's type doesn't match the type expected here (a written annotation, or the name's existing type).",
    "message": "This value has type {actual}, but {expected} was expected here.",
    "explanation": "A value's type has to fit the type asked for in this spot. Here the value is {actual} and {expected} was expected, and those don't match. (An Int can go where a Float is expected, but not the other way around.)",
    "related": [
      {
        "key": "annotation",
        "label": "the type was set to {expected} here"
      },
      {
        "key": "declaration",
        "label": "this was created holding {expected}"
      }
    ]
  },
  {
    "code": "T0002",
    "name": "incompatible-list-elements",
    "category": "type",
    "summary": "A list mixes items of types that have no common type.",
    "message": "The items in this list don't all have the same type.",
    "explanation": "Every item in a list shares one type. Some items here are {first}, but this one is {other}, and those don't fit together. (A mix of Int and Float is fine — the Ints become Floats — but unrelated types like Int and String can't share a list.)",
    "related": [
      {
        "key": "element",
        "label": "this item is {other}"
      }
    ]
  },
  {
    "code": "T0003",
    "name": "empty-list-needs-annotation",
    "category": "type",
    "summary": "An empty list has no items to show its type, and none was written down.",
    "message": "This empty list needs a type.",
    "explanation": "An empty list '[]' has no items to show what it holds, so its type has to be written down — for example 'fix xs: List<Int> = []'."
  },
  {
    "code": "T0004",
    "name": "condition-not-bool",
    "category": "type",
    "summary": "The condition of an 'if' or 'while' isn't a True/False value.",
    "message": "This condition has type {actual}, but it has to be True or False.",
    "explanation": "An 'if' or 'while' chooses what to do from a True/False value, so its condition has to be one — a comparison like 'x > 0', or another Bool. This one has type {actual}."
  },
  {
    "code": "T0005",
    "name": "if-branch-mismatch",
    "category": "type",
    "summary": "The two branches of an 'if' produce different types.",
    "message": "The two branches of this 'if' have different types.",
    "explanation": "When an 'if' is used as a value, both branches have to produce the same type, because the whole 'if' becomes one value. Here one branch gives {then} and the other gives {else}.",
    "related": [
      {
        "key": "then",
        "label": "this branch gives {then}"
      },
      {
        "key": "else",
        "label": "this branch gives {else}"
      }
    ]
  },
  {
    "code": "T0006",
    "name": "no-such-method",
    "category": "type",
    "summary": "A method with this name doesn't exist on the value's type.",
    "message": "{type} has no method called '{method}'.",
    "explanation": "The methods you can call depend on the value's type. For example, an Int has 'toString()', 'toFloat()', and 'abs()'; a list has 'length()', 'append(…)', 'reverse()', and more. Check the spelling of '{method}'."
  },
  {
    "code": "T0007",
    "name": "wrong-arg-count",
    "category": "type",
    "summary": "A method or function call was given the wrong number of inputs.",
    "message": "This call has the wrong number of inputs.",
    "explanation": "It needs {expected}, but was given {got}. Each input goes inside the '( )', separated by commas."
  },
  {
    "code": "T0008",
    "name": "wrong-arg-type",
    "category": "type",
    "summary": "An input to a method or function has a type that isn't accepted here.",
    "message": "This input has type {actual}, but {expected} was expected.",
    "explanation": "Each method or function accepts inputs of certain types. Here {expected} was expected, but the input given is {actual}."
  },
  {
    "code": "T0009",
    "name": "operator-type-error",
    "category": "type",
    "summary": "An operator was used on types it doesn't accept.",
    "message": "I can't use '{op}' on {operands}.",
    "explanation": "Operators only work on certain types: '+', '-', '*', '/', and '**' need numbers (Int or Float); 'div' and 'mod' need whole numbers (Int); 'and', 'or', and 'not' need True/False values (Bool); and a comparison needs two values of the same kind. '{op}' doesn't work on {operands}."
  },
  {
    "code": "T0010",
    "name": "index-requires-list",
    "category": "type",
    "summary": "The '[ ]' index was used on something that isn't a list.",
    "message": "I can't use '[ ]' here — this has type {actual}, not a list.",
    "explanation": "Reading an item with '[ ]', like 'items[0]', works only on a list. This value has type {actual}, which isn't a list."
  },
  {
    "code": "T0011",
    "name": "index-not-int",
    "category": "type",
    "summary": "A list index isn't an Int.",
    "message": "A list index has to be an Int, but this has type {actual}.",
    "explanation": "Inside 'items[…]', the value in the brackets picks an item by its position, counting from 0, so it has to be a whole number (Int). This one has type {actual}."
  },
  {
    "code": "T0012",
    "name": "no-methods",
    "category": "type",
    "summary": "The value's type has no methods at all.",
    "message": "Values of type {type} don't have any methods.",
    "explanation": "Only some types have methods you can call with '.': Int, Float, and List. A {type} has none, so 'value.something()' can't be used on it."
  },
  {
    "code": "T0013",
    "name": "unknown-function",
    "category": "type",
    "summary": "A call names a function that doesn't exist.",
    "message": "There's no function called '{name}'.",
    "explanation": "Ascent has just one built-in function right now — 'floor(x)', which rounds a Float down to a whole number. Everything else is a method, called on a value with '.', like 'x.toString()'."
  },
  {
    "code": "T0014",
    "name": "interpolation-not-scalar",
    "category": "type",
    "summary": "A '${ }' hole's value isn't an Int, Float, Bool, or String.",
    "message": "This '${ }' hole has type {actual}, which can't go straight into text.",
    "explanation": "A '${ }' hole puts its value straight into the surrounding text. Int, Float, Bool, and String all have one obvious way to show as text, so they're accepted directly. {actual} isn't one of those."
  },
  {
    "code": "T0015",
    "name": "none-needs-annotation",
    "category": "type",
    "summary": "A slot's only starting value is None, so its type has to be written down.",
    "message": "This slot needs a type.",
    "explanation": "'None' on its own doesn't say what kind of value the slot will hold — so, just like an empty list '[]', its type has to be written down — for example 'fix nick: String? = None'."
  }
];

export const byCode = new Map(ERRORS.map(e => [e.code, e]));
