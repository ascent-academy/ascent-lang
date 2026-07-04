# Ascent: The Teaching Language

> *Ascent is a programming language built to teach programming to complete beginners. The goal is to do it clearly, gently, and from the ground up.*


This is the development package for gradually building a compiler and tooling for Ascent. It provides a command-line interface (CLI) for running Ascent programs, as well as a library for integrating the Ascent compiler into your own tooling.

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
