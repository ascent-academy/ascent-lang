import chalk from 'chalk';
import type { Span } from '../lexer/token.js';
import type { Diagnostic } from './elaborate.js';

// One span rendered as its source line plus an underline, with an optional
// trailing label. `mark` is the underline character and `colour` tints it, so
// the primary span (red '^') and a supporting span (cyan '-') look distinct.
function snippet(
  sourceLines: string[],
  span: Span,
  mark: string,
  colour: (s: string) => string,
  label: string | null,
): string[] {
  const line = sourceLines[span.start.line - 1] ?? '';
  // A span may run to the line end (an unterminated string), so clamp the
  // underline to the visible text of its starting line.
  const endColumn = span.end.line === span.start.line ? span.end.column : line.length + 1;
  const underline = mark.repeat(Math.max(1, endColumn - span.start.column));
  const gutter = String(span.start.line);
  const blank = ' '.repeat(gutter.length);
  const caret = `${' '.repeat(span.start.column - 1)}${colour(underline)}`;
  return [
    `${chalk.dim(`${gutter} |`)} ${line}`,
    `${chalk.dim(`${blank} |`)} ${label !== null ? `${caret} ${colour(label)}` : caret}`,
  ];
}

export function renderTerminal(d: Diagnostic, source: string, filePath: string | null): string {
  const sourceLines = source.split('\n');
  const lines: string[] = [];

  lines.push(chalk.red.bold(`Error ${d.code}`) + chalk.bold(`: ${d.message}`));

  const where = filePath !== null
    ? `${filePath}:${d.span.start.line}:${d.span.start.column}`
    : `line ${d.span.start.line}, column ${d.span.start.column}`;
  lines.push(chalk.dim(`  → ${where}`));

  lines.push(...snippet(sourceLines, d.span, '^', chalk.red, null));

  // Supporting spans (e.g. "'count' was created with 'fix' here") point back at
  // context elsewhere in the source, each with its own snippet.
  for (const rel of d.related) {
    lines.push(...snippet(sourceLines, rel.span, '-', chalk.cyan, rel.label));
  }

  if (d.explanation !== null) {
    lines.push('');
    lines.push(d.explanation);
  }

  if (d.fix !== null) {
    lines.push('');
    lines.push(chalk.green(`fix: ${d.fix.title}`));
  }

  return lines.join('\n');
}
