import type { Span } from '../lexer/token.js';

// A multiline """..."""  string's raw text, collected chunk by chunk while
// parsing (src/parser/expr.ts parseMultilineStringTemplate) — `raw` is
// exactly as the lexer scanned it: escapes undecoded, real source newlines
// intact. `span` anchors error reporting for this chunk.
export interface RawChunk {
  raw: string;
  span: Span;
}

export interface DedentError {
  code: string;
  span: Span;
}

export interface DedentResult {
  // One final (margin-stripped, escape-resolved) string per input chunk,
  // same order and length as `chunks`.
  texts: string[];
  errors: DedentError[];
}

// Turns the raw chunks of one multiline string into their final text, per
// design.md §4: the closing '"""''s column (`margin`) is stripped from every
// line, a newline right after the opening '"""'  is dropped, and — because
// the lexer defers this (see readMultilineChunk) — escapes are resolved
// here too. Pure: no lexer/parser dependency, so it's independently
// testable and this is the *only* place any of this logic lives.
export function dedent(chunks: RawChunk[], margin: number): DedentResult {
  const errors: DedentError[] = [];
  const raws = chunks.map(c => c.raw);

  // Drop the newline immediately after the opening '"""', if present — it's
  // delimiter furniture, not text, and content starts on the next line.
  // This also decides the initial "are we at a fresh line" state: only true
  // if there was a leading newline to drop — content sharing the opening
  // delimiter's own line was never indented to match the closing column, so
  // it isn't margin-stripped either.
  let atLineStart = false;
  if (raws.length > 0 && raws[0]!.startsWith('\n')) {
    raws[0] = raws[0]!.slice(1);
    atLineStart = true;
  }

  // Drop the closing delimiter's own line: if the last chunk's raw text
  // has a real newline after which nothing but whitespace remains (the
  // closing '"""'  sits alone on its line, the idiomatic form), that
  // trailing newline + margin whitespace is dropped entirely rather than
  // becoming an empty trailing line. If it doesn't — the closing '"""'
  // shares its line with real content — nothing is dropped, and that
  // shared line is exempt from margin-stripping below, symmetric with how
  // a first line sharing the *opening* delimiter is exempt above: neither
  // was ever indented to match anything, they're just wherever the
  // delimiter happened to sit.
  let closingSharesLine = true;
  if (raws.length > 0) {
    const last = raws[raws.length - 1]!;
    const lastNewline = last.lastIndexOf('\n');
    if (lastNewline !== -1 && last.slice(lastNewline + 1).trim() === '') {
      raws[raws.length - 1] = last.slice(0, lastNewline);
      closingSharesLine = false;
    }
  }

  const texts = raws.map((raw, i) => {
    const span = chunks[i]!.span;
    const isLastChunk = i === raws.length - 1;
    const lines = raw.split('\n');
    const dedentedLines = lines.map((line, li) => {
      const isVeryLastLine = isLastChunk && li === lines.length - 1;
      if (isVeryLastLine && closingSharesLine) return line;
      const shouldDedent = li === 0 ? atLineStart : true;
      return shouldDedent ? stripMargin(line, margin, span, errors) : line;
    });
    // Whatever comes right after this chunk (a hole, or the string's end)
    // starts at a fresh line exactly when this chunk's raw text ended in a
    // real newline — carried into the next chunk's li === 0 check above.
    atLineStart = raw.endsWith('\n');
    return resolveEscapes(dedentedLines.join('\n'), span, errors);
  });

  return { texts, errors };
}

// Strips `margin` leading characters from one line. A blank (whitespace-only)
// line is exempt from the requirement — it strips whatever whitespace it
// has, up to margin — since a separator line shouldn't need padding out to
// match. A non-blank line needs at least `margin` leading whitespace
// characters; anything less is a hard error (L0006), not a silent partial
// strip, matching this project's no-silent-anything stance.
const stripMargin = (line: string, margin: number, span: Span, errors: DedentError[]): string => {
  if (line.trim() === '') {
    return line.length > margin ? line.slice(margin) : '';
  }
  const prefix = line.slice(0, margin);
  if (prefix.length < margin || prefix.trim() !== '') {
    errors.push({ code: 'L0006', span });
    return line;
  }
  return line.slice(margin);
};

// The same escapes readStringChunk resolves inline for a single-line string
// (design.md §4) — deferred to here for a multiline one, since the lexer
// copies '\' + the next character through raw (readMultilineChunk), which
// is what guarantees every '\n' reaching stripMargin above is a real source
// newline, never one this function is about to produce.
const resolveEscapes = (text: string, span: Span, errors: DedentError[]): string => {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const esc = text[i + 1];
    i++;
    switch (esc) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '$': out += '$'; break;
      default: errors.push({ code: 'L0001', span }); break;
    }
  }
  return out;
};
