# Ascent Language — VS Code extension

Syntax highlighting for the [Ascent](../../README.md) teaching language (`.asc` files).

This is a **static TextMate grammar** — no runtime, no build step. It approximates
the coloring with regexes; for pixel-accurate coloring driven by the real lexer,
see the semantic-tokens upgrade note at the bottom.

## What's here

| File | Role |
| --- | --- |
| `package.json` | Extension manifest — registers the `ascent` language, `.asc` extension, and the grammar. |
| `language-configuration.json` | Editor behavior — line/block comments, bracket matching, auto-closing pairs. |
| `syntaxes/ascent.tmLanguage.json` | The TextMate grammar — the actual highlighting rules. |

The grammar is built from the lexer's token set: keywords come from
[`src/lexer/keywords.ts`](../../src/lexer/keywords.ts) and the token kinds from
[`src/lexer/token.ts`](../../src/lexer/token.ts).

## Try it live

```bash
code editors/vscode      # open this folder in VS Code
```

Press **F5** — this launches an *Extension Development Host* window with the
extension loaded. Open any `.asc` file there (e.g. the ones in
[`test-programs/`](../../test-programs)) to see highlighting.

Handy while iterating:

- **Developer: Inspect Editor Tokens and Scopes** — shows the TextMate scope
  under the cursor, so you can see exactly which rule matched.
- **Developer: Reload Window** — reload after editing the grammar.

## Package / install

```bash
npm i -g @vscode/vsce
cd editors/vscode
vsce package                                   # -> ascent-lang-0.1.0.vsix
code --install-extension ascent-lang-0.1.0.vsix
```

## Coverage

- Line comments `# …` and nesting block comments `#[ … ]#`
- Strings `"…"` and multiline `"""…"""`, both with `${…}` interpolation and escapes
- `Int` / `Float` numeric literals
- Language constants `True` `False` `None` `Done`
- Keywords, split by role (control / declaration / word-operators / other)
- UpperCamel type names and constructors
- Operators and punctuation

## Upgrade path: semantic tokens

For exact coloring that reuses the real lexer instead of regex approximations,
add a `DocumentSemanticTokensProvider` that calls `Lexer.tokenize()` and maps
`syntaxClass(kind)` (see [`src/lexer/token.ts`](../../src/lexer/token.ts)) to VS
Code semantic token types. That turns this into a full TypeScript extension with
an `activate()` entry point, but the token→color mapping is already a one-liner
in the codebase.
