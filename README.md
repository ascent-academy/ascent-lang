# Ascent: The Teaching Language

> *Ascent is a programming language built to teach programming to complete beginners. The goal is to do it clearly, gently, and from the ground up.*

## ⚠️ Experimental

`@ascent-lang/dev` is an experimental package intended for rapid development and language exploration.

During this phase, the language syntax, parser, interpreter, APIs, and project structure may change frequently between releases. Breaking changes may occur at any time, and version numbers should not be interpreted as indicators of API stability.

This package is primarily intended for:
- experimenting with new language features,
- testing language design ideas,
- early adopters interested in following development.

Once the language and architecture mature, functionality will be split into dedicated packages such as `@ascent-lang/parser`, `@ascent-lang/interpreter`, and `@ascent-lang/core`, which will follow a more stable versioning and compatibility policy.

Until then, expect frequent changes and be prepared to update your code when upgrading to newer releases.

## Installation

```bash
npm install -g @ascent-lang/dev
```

Or run it once without installing:

```bash
npx @ascent-lang/dev path/to/program.asc
```

## Using the CLI

Run a `.asc` file:

```bash
ascent program.asc
```

If the program declares `args`, pass them as flags:

```bash
ascent program.asc --name Ada --score 95
```

Start the interactive REPL by running `ascent` with no file:

```bash
ascent
```

## Using it as a library

The individual pipeline stages are exported from the package entry point,
so you can lex, parse, type-check, and interpret Ascent source from your own
tooling:

```js
import { Lexer, Parser, typecheck, executeProgram, Environment } from '@ascent-lang/dev';

const source = '1 + 2';
const { tokens } = new Lexer(source).tokenize();
const { program } = new Parser(tokens).parse();
const { typedProgram } = typecheck(program);
const result = executeProgram(typedProgram, new Environment());

console.log(result); // { type: 'Int', value: 3n }
```
