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
    "code": "N0005",
    "name": "unknown-type",
    "category": "name",
    "summary": "A type name was used that hasn't been declared.",
    "message": "I can't find a type named '{name}'.",
    "explanation": "A type has to be declared with 'type' before it's used, like 'type Person = { name: String }'. Check that '{name}' is spelled the same as where you declared it, and that its declaration comes before this line."
  },
  {
    "code": "N0006",
    "name": "duplicate-type",
    "category": "name",
    "summary": "A type was declared with a name that's already a type.",
    "message": "There's already a type named '{found}'.",
    "explanation": "Each type name is declared once. '{found}' is already the name of another type, so this second 'type {found} = …' would give the same name two meanings. Rename one of them.",
    "related": [
      {
        "key": "declaration",
        "label": "'{found}' was already declared here"
      }
    ]
  },
  {
    "code": "N0007",
    "name": "duplicate-field",
    "category": "name",
    "summary": "A record type declares two fields with the same name.",
    "message": "This type already has a field named '{name}'.",
    "explanation": "Each field of a record has its own name, and the names have to be different so every field can be told apart. '{name}' is listed twice here — remove or rename one of them.",
    "related": [
      {
        "key": "declaration",
        "label": "'{name}' was already listed here"
      }
    ]
  },
  {
    "code": "N0008",
    "name": "redeclare-builtin-type",
    "category": "name",
    "summary": "A 'type' declaration reuses a built-in type name.",
    "message": "'{name}' is a built-in type, so it can't be redeclared.",
    "explanation": "'{name}' already names one of the language's built-in types (Int, Float, Bool, String, List), so a 'type' declaration can't reuse it. Choose a different name for your type."
  },
  {
    "code": "N0009",
    "name": "duplicate-variant",
    "category": "name",
    "summary": "A 'type' declares two variants with the same name.",
    "message": "This type already has a variant named '{tag}'.",
    "explanation": "Each variant of a 'type' has its own name, and the names have to be different so every case can be told apart when you build or match one. '{tag}' is listed twice here — remove or rename one of them.",
    "related": [
      {
        "key": "declaration",
        "label": "'{tag}' was already listed here"
      }
    ]
  },
  {
    "code": "N0010",
    "name": "duplicate-constructor",
    "category": "name",
    "summary": "A variant name is already used by another type.",
    "message": "There's already a variant named '{tag}', in the type '{owner}'.",
    "explanation": "A variant name is how you build and match that case, so each one belongs to a single type. '{tag}' already names a variant of '{owner}', so a second type can't reuse it — the name would no longer say which type you meant. Rename this variant.",
    "related": [
      {
        "key": "declaration",
        "label": "'{tag}' was already declared here"
      }
    ]
  },
  {
    "code": "N0011",
    "name": "construct-multi-variant",
    "category": "name",
    "summary": "A multi-variant type is built by its type name instead of a variant.",
    "message": "'{name}' has more than one variant, so build one of them: {variants}.",
    "explanation": "A type with several variants isn't built directly — you build one of its variants, since each carries its own fields. '{name}' has these variants: {variants}. Write one of those names in place of '{name}' here, like 'Circle{ radius: 2.0 }'."
  },
  {
    "code": "N0012",
    "name": "builtin-type-as-value",
    "category": "name",
    "summary": "A built-in type name was used where a value belongs.",
    "message": "'{name}' is a built-in type, not a value.",
    "explanation": "'{name}' names one of the built-in types (Int, Float, Bool, String, List). A type is the shape a value has, not a value itself, so it can't stand where a value is expected. To make a value, write one directly — a number like 42, a string like \"hi\", or a list like [1, 2]."
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
    "summary": "'.slice(start..end)' had a start or end outside the String's valid range.",
    "message": "'.slice({start}..{end})' is out of range for this String.",
    "explanation": "'.slice(start..end)' counts characters from 0 and the end is exclusive, so a String with {length} character(s) only accepts a start and end between 0 and {length}, with start no greater than end. '{start}' and '{end}' don't fit that rule here."
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
    "summary": "A name was expected after 'fix' or 'mut', as a program input, or as a function parameter.",
    "message": "I expected a name here.",
    "explanation": "A name is needed here — after 'fix' or 'mut' to create one ('fix count = 0'), as the name of a program input ('program (age: Int) { … }'), or as a function parameter ('fn(x: Int) -> Int { … }'). A name starts with a lowercase letter."
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
    "summary": "A '(' was expected to open a condition, a 'program' input list, or a function's parameters.",
    "message": "I expected a '(' here.",
    "explanation": "An 'if' or 'while' condition, the inputs listed after 'program', and a function's parameters all go inside '( )' — like 'if (age >= 18) { … }', 'program (age: Int) { … }', or 'fn(x: Int) -> Int { … }'. This is where that opening '(' should be."
  },
  {
    "code": "S0007",
    "name": "expected-block",
    "category": "syntactic",
    "summary": "A block ('{ … }') was expected here.",
    "message": "I expected a '{' here.",
    "explanation": "The body of an 'if', 'else', 'while', or 'program' is always a block between '{' and '}', even when it holds a single line, as in 'if (ok) { … }' or 'program (age: Int) { … }'."
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
    "summary": "A ':' was expected between a program input's or function parameter's name and its type.",
    "message": "I expected a ':' here.",
    "explanation": "A program input and a function parameter are each written as a name, then ':', then its type — like 'program (age: Int) { … }' or 'fn(x: Int) -> Int { … }'. This is where the ':' should be."
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
    "code": "S0016",
    "name": "expected-loop-name",
    "category": "syntactic",
    "summary": "A loop variable name was expected after 'for'.",
    "message": "I expected a name or a pattern here.",
    "explanation": "A 'for' loop names each item as it goes, like 'for item in items' or 'for i in 0..n'. The name comes right after 'for', and it starts with a lowercase letter. It can also destructure each item into its fields with a pattern, like 'for Point{ x, y } in points'."
  },
  {
    "code": "S0017",
    "name": "expected-in",
    "category": "syntactic",
    "summary": "'in' was expected after the loop variable in a 'for' loop.",
    "message": "I expected 'in' here.",
    "explanation": "A 'for' loop is written 'for name in values', so 'in' comes after the loop variable and before what's being looped over, as in 'for i in 0..n'."
  },
  {
    "code": "S0018",
    "name": "expected-type-name",
    "category": "syntactic",
    "summary": "A type name was expected after 'type'.",
    "message": "I expected a type name here.",
    "explanation": "A 'type' declaration gives a new type its name, like 'type Person = { … }'. The name comes right after 'type', and it starts with an uppercase letter."
  },
  {
    "code": "S0019",
    "name": "expected-type-equals",
    "category": "syntactic",
    "summary": "An '=' was expected after the name in a 'type' declaration.",
    "message": "I expected an '=' here.",
    "explanation": "A 'type' declaration is written 'type Name = { … }', so '=' comes after the name and before the fields, as in 'type Person = { name: String }'."
  },
  {
    "code": "S0020",
    "name": "expected-record-brace",
    "category": "syntactic",
    "summary": "A '{' was expected to open a record's fields.",
    "message": "I expected a '{' here.",
    "explanation": "A record type lists its fields between '{' and '}', like 'type Person = { name: String, age: Int }'. This is where that opening '{' should be."
  },
  {
    "code": "S0021",
    "name": "expected-field-name",
    "category": "syntactic",
    "summary": "A field name was expected here.",
    "message": "I expected a field name here.",
    "explanation": "A record's fields are each written as a name, like the 'name' and 'age' in 'Person{ name: \\\"Ann\\\", age: 30 }'. A field name starts with a lowercase letter."
  },
  {
    "code": "S0022",
    "name": "expected-field-colon",
    "category": "syntactic",
    "summary": "A ':' was expected after a field name.",
    "message": "I expected a ':' here.",
    "explanation": "Each field is written as a name, then ':', then its type or value — like 'name: String' when declaring a type, or 'name: \\\"Ann\\\"' when building one. This is where the ':' should be."
  },
  {
    "code": "S0023",
    "name": "type-name-needs-braces",
    "category": "syntactic",
    "summary": "A type name was used as a value without '{ … }'.",
    "message": "'{found}' names a type, so it needs '{ … }' to build a value.",
    "explanation": "A name that starts with an uppercase letter is a type. To make a value of it, follow it with its fields in braces, like 'Person{ name: \\\"Ann\\\", age: 30 }'. On its own, '{found}' isn't a value yet.",
    "retired": true
  },
  {
    "code": "S0024",
    "name": "expected-match-brace",
    "category": "syntactic",
    "summary": "A '{' was expected to open a 'match'’s arms.",
    "message": "I expected a '{' here.",
    "explanation": "A 'match' lists its arms between '{' and '}', each written as a pattern, then '->', then a result — like 'match n { 0 -> \"none\"; else -> \"some\" }'. This is where that opening '{' should be."
  },
  {
    "code": "S0025",
    "name": "expected-pattern",
    "category": "syntactic",
    "summary": "A pattern was expected at the start of a 'match' arm.",
    "message": "I expected a pattern here.",
    "explanation": "Each arm of a 'match' starts with a pattern — a plain value to compare against, like '0', '\"hi\"', or 'True', or the word 'else' for the catch-all arm. This is where that pattern should be."
  },
  {
    "code": "S0026",
    "name": "expected-arrow",
    "category": "syntactic",
    "summary": "A '->' was expected after a 'match' arm's pattern.",
    "message": "I expected a '->' here.",
    "explanation": "Each arm of a 'match' is written as a pattern, then '->', then the result to use when it matches — like '0 -> \"none\"'. This is where the '->' should be."
  },
  {
    "code": "S0027",
    "name": "expected-variant",
    "category": "syntactic",
    "summary": "A variant name was expected in a 'type' declaration.",
    "message": "I expected a variant name here.",
    "explanation": "After the '=' of a 'type', each case is a variant — a name that starts with an uppercase letter, followed by its fields in braces, like the 'Circle' in 'type Shape = Circle{ radius: Float } | Square{ side: Float }'. Variants are separated by '|'. This is where a variant name should be."
  },
  {
    "code": "S0028",
    "name": "empty-braces",
    "category": "syntactic",
    "summary": "Empty braces '{}' were written where a name with no fields belongs.",
    "message": "Empty braces '{}' aren't allowed here.",
    "explanation": "A variant with no fields is written as just its name, like 'Red' in 'type Light = Red | Green', and it's built the same way — 'fix c = Red'. Empty braces would be a second spelling for that same no-fields case, so they're not allowed. Drop the '{}', or add the fields it should hold."
  },
  {
    "code": "S0029",
    "name": "empty-program-inputs",
    "category": "syntactic",
    "summary": "A 'program (…)' was written with no inputs between its '( )'.",
    "message": "A 'program' needs at least one input here.",
    "explanation": "The 'program (…) { … }' form is for a program that takes named inputs, so it lists at least one, like 'program (age: Int) { … }'. A program that takes no inputs doesn't use 'program' at all — it's just a sequence of statements on their own. Add an input like 'name: Type', or drop the 'program (…) { … }' wrapper and leave the statements bare."
  },
  {
    "code": "S0030",
    "name": "content-after-program",
    "category": "syntactic",
    "summary": "Something was written after the 'program' block.",
    "message": "I expected the file to end after the 'program' block.",
    "explanation": "A 'program (…) { … }' block is the whole program, so nothing comes after its closing '}'. Everything the program does goes inside the braces."
  },
  {
    "code": "S0031",
    "name": "expected-return-type",
    "category": "syntactic",
    "summary": "A function's parameters weren't followed by '->' and a return type.",
    "message": "I expected '->' and a return type here.",
    "explanation": "A function states its return type right after its parameters, like 'fn(x: Int) -> Int { … }' — the '->' and then the type the function gives back. Every function says what it returns; one that returns nothing returns 'Done'. Add '-> Type' after the ')'."
  },
  {
    "code": "S0032",
    "name": "empty-program-body",
    "category": "syntactic",
    "summary": "A 'program' block has no statements.",
    "message": "A 'program' block needs at least one statement.",
    "explanation": "The 'program (…) { … }' block is where a program does its work, so it needs at least one statement between its braces. An empty '{ }' runs nothing and uses none of the inputs it declares. Add the statements the program should run."
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
    "explanation": "Only some types have methods you can call with '.': Int, Float, String, List, and Range. A {type} has none, so 'value.something()' can't be used on it."
  },
  {
    "code": "T0013",
    "name": "unknown-function",
    "category": "type",
    "summary": "A call names a function that doesn't exist.",
    "message": "There's no function called '{name}'.",
    "explanation": "Ascent has just one built-in function right now — 'print(text)', which shows a String as output. Everything else is a method, called on a value with '.', like 'x.toString()'."
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
  },
  {
    "code": "T0016",
    "name": "range-bounds-not-int",
    "category": "type",
    "summary": "A range's start or end isn't an Int.",
    "message": "A range's start and end have to be Ints, but this is {actual}.",
    "explanation": "A range like '0..n' counts whole steps from its start up to (but not including) its end, so both sides have to be whole numbers (Int). This one is {actual}."
  },
  {
    "code": "T0017",
    "name": "for-not-iterable",
    "category": "type",
    "summary": "A 'for' loop was given something that isn't a list or a range.",
    "message": "I can't loop over this — it has type {actual}.",
    "explanation": "'for x in …' goes through the items of a list ('for x in items') or the numbers of a range ('for i in 0..n'). This value is {actual}, which isn't either of those."
  },
  {
    "code": "T0018",
    "name": "missing-field",
    "category": "type",
    "summary": "A record is built without all of its fields.",
    "message": "'{type}' is missing {fields} here.",
    "explanation": "Building a record fills in every field the type declares. Add a value for {fields}, so '{type}' has every field it needs."
  },
  {
    "code": "T0019",
    "name": "unknown-field",
    "category": "type",
    "summary": "A record is built with a field its type doesn't have.",
    "message": "'{type}' has no field named '{field}'.",
    "explanation": "A record can only be built with the fields its type declares. '{type}' doesn't have a field '{field}' — check the spelling against the type's declaration, or remove it."
  },
  {
    "code": "T0020",
    "name": "duplicate-field-value",
    "category": "type",
    "summary": "A record is built with the same field given twice.",
    "message": "'{field}' is given more than once here.",
    "explanation": "Each field of a record gets one value when it's built. '{field}' is listed twice, so it isn't clear which value to use — remove one of them."
  },
  {
    "code": "T0021",
    "name": "field-type-mismatch",
    "category": "type",
    "summary": "A field is built with a value of the wrong type.",
    "message": "This field expects {expected}, but this value is {actual}.",
    "explanation": "Each field holds a value of the type its declaration gives it. This field is declared {expected}, but the value here is {actual}, and those don't match. (An Int can go where a Float is expected, but not the other way around.)",
    "related": [
      {
        "key": "field",
        "label": "this field is declared {expected}"
      }
    ]
  },
  {
    "code": "T0022",
    "name": "field-access-non-record",
    "category": "type",
    "summary": "A '.field' was read from a value that isn't a record.",
    "message": "I can't read a field from this — it has type {type}.",
    "explanation": "Reading a field with '.name' works on a record — a value of a type declared with 'type Name = { … }'. This value is {type}, which has no fields to read."
  },
  {
    "code": "T0023",
    "name": "no-such-field",
    "category": "type",
    "summary": "A field was read that the record's type doesn't have.",
    "message": "'{type}' has no field named '{field}'.",
    "explanation": "A record only has the fields its type declares. '{type}' doesn't have a field '{field}' — check the spelling against the type's declaration."
  },
  {
    "code": "T0024",
    "name": "print-not-displayable",
    "category": "type",
    "summary": "A value passed to 'print' has no text form.",
    "message": "'print' can't show a value of type {actual}.",
    "explanation": "'print' shows a value as text, so it needs a value that has one obvious way to show: Int, Float, Bool, and String do. {actual} isn't one of those — you need to convert it to a String first."
  },
  {
    "code": "T0025",
    "name": "value-dropped-by-next-statement",
    "category": "type",
    "summary": "A value is produced but thrown away because another statement comes after it.",
    "message": "This {actual} value isn't used by anything.",
    "explanation": "Only the last statement in a block keeps its value; another statement comes after this one, so its {actual} value would be quietly thrown away — and a thrown-away value is usually a mistake, like calling a method for its result and forgetting to use it. Use the value: give it a name ('fix x = …'), pass it to a function, or make it the last statement. If throwing it away is what you meant, write 'void' in front ('void …') to say so on purpose."
  },
  {
    "code": "T0026",
    "name": "value-dropped-by-loop",
    "category": "type",
    "summary": "A loop body ends in a value the loop throws away each time around.",
    "message": "This {actual} value is thrown away on every pass of the loop.",
    "explanation": "A 'for' or 'while' loop doesn't build a value — it runs its body for the effect and yields Done, so whatever the body ends with is thrown away on every pass. Here that value is {actual}. If throwing it away is what you meant, write 'void' in front ('void …') to say so on purpose."
  },
  {
    "code": "T0027",
    "name": "void-nothing-to-discard",
    "category": "type",
    "summary": "'void' is used on a value that is already Done.",
    "message": "There's nothing to throw away here — this is already Done.",
    "explanation": "'void' throws away a value in a spot where it would otherwise be kept. This expression is already Done — it produces no value (an effect like 'print', or a loop) — so there's nothing for 'void' to throw away. Remove the 'void'."
  },
  {
    "code": "T0028",
    "name": "match-pattern-type-mismatch",
    "category": "type",
    "summary": "A 'match' pattern can't be compared to the value being matched.",
    "message": "This pattern is {actual}, but the value being matched is {expected}.",
    "explanation": "Each arm's pattern is compared against the value in the 'match', so it has to be something that value could equal. Here the value being matched has type {expected}, but this pattern is {actual}, and those two can never be equal.",
    "related": [
      {
        "key": "subject",
        "label": "this value is {expected}"
      }
    ]
  },
  {
    "code": "T0029",
    "name": "match-not-exhaustive",
    "category": "type",
    "summary": "A 'match' doesn't cover every possible value.",
    "message": "This 'match' doesn't handle every possible value.",
    "explanation": "A 'match' has to produce a value no matter which value it's given, so its arms together have to cover every case. Add an 'else' arm to handle any value the arms above didn't list, like 'else -> 0'."
  },
  {
    "code": "T0030",
    "name": "match-arms-mismatch",
    "category": "type",
    "summary": "The arms of a 'match' produce different types.",
    "message": "The arms of this 'match' produce different types.",
    "explanation": "A 'match' used as a value becomes one value, so every arm has to produce the same type. Here one arm gives {first} and another gives {other}.",
    "related": [
      {
        "key": "arm",
        "label": "this arm gives {other}"
      }
    ]
  },
  {
    "code": "T0031",
    "name": "unreachable-match-arm",
    "category": "type",
    "summary": "A 'match' arm can never be reached.",
    "message": "This arm can never be reached.",
    "explanation": "The arms of a 'match' are tried in order, and an earlier arm already handles every value this one would — either it comes after an 'else' (which matches everything), or an earlier arm has the very same pattern. So this arm never runs. Remove it, or change what it matches.",
    "related": [
      {
        "key": "shadow",
        "label": "this earlier arm already matches it"
      }
    ]
  },
  {
    "code": "T0032",
    "name": "field-access-on-union",
    "category": "type",
    "summary": "A '.field' was read from a value that has more than one variant.",
    "message": "'{type}' has more than one variant, so it has no fields to read directly.",
    "explanation": "Reading a field with '.name' works on a record — a type with a single variant, whose fields are always the same. '{type}' has more than one variant ({variants}), so which fields it has depends on which one it is. A 'match' looks at each variant on its own and reads that variant's fields."
  },
  {
    "code": "T0033",
    "name": "refutable-binding",
    "category": "type",
    "summary": "A union variant is destructured in a 'fix'/'mut' binding, where it might not match.",
    "message": "'{type}' has more than one variant, so this pattern might not match.",
    "explanation": "Destructuring in a 'fix' or 'mut' binding pulls fields out of a value whose shape is always the same — a record, a type with a single variant. '{type}' has more than one variant ({variants}), so a value of it could be any of them, and a pattern naming one case would not match the others. Use 'match' to handle each variant on its own."
  },
  {
    "code": "T0034",
    "name": "match-missing-variants",
    "category": "type",
    "summary": "A 'match' on a union doesn't handle every variant.",
    "message": "This 'match' doesn't handle {missing}.",
    "explanation": "A 'match' has to produce a value for every case it might be given. '{type}' has the variants {variants}, but this 'match' has no arm for {missing}. Add an arm for each one it's missing, or an 'else' arm to cover the rest."
  },
  {
    "code": "T0035",
    "name": "not-callable",
    "category": "type",
    "summary": "A name that isn't a function is being called.",
    "message": "'{name}' is a {type}, not a function, so it can't be called.",
    "explanation": "Only a function can be called with '(…)'. Here '{name}' holds a {type}, which isn't a function, so 'name(…)' has nothing to call. Check that '{name}' is the name you meant, or that it was created as a function with 'fn(…) -> … { … }'."
  },
  {
    "code": "T0036",
    "name": "return-type-mismatch",
    "category": "type",
    "summary": "A function produces a value that doesn't match its declared return type.",
    "message": "This function returns {expected}, but this value is {actual}.",
    "explanation": "A function has to give back a value of the return type it declares. This one is declared to return {expected}, but the value it produces here is {actual}, and those don't match. (An Int can go where a Float is expected, but not the other way around.) Produce a {expected}, or change the declared return type.",
    "related": [
      {
        "key": "annotation",
        "label": "the return type was set to {expected} here"
      }
    ]
  },
  {
    "code": "T0037",
    "name": "return-outside-function",
    "category": "type",
    "summary": "A 'return' was written outside any function.",
    "message": "'return' can only be used inside a function.",
    "explanation": "'return' leaves the function it is in, handing back a value — so it only makes sense inside one, like 'fn(x: Int) -> Int { return x }'. Here there is no enclosing function to return from. At the top level, a program's value is simply its last statement (no 'return' needed)."
  }
];

export const byCode = new Map(ERRORS.map(e => [e.code, e]));
