import chalk from 'chalk';
import type { Diagnostic } from './elaborate.js';

export function renderTerminal(d: Diagnostic, source: string, filePath: string | null): string {
  const { span } = d;
  const lines: string[] = [];

  lines.push(chalk.red.bold(`Error ${d.code}`) + chalk.bold(`: ${d.message}`));

  const where = filePath !== null
    ? `${filePath}:${span.start.line}:${span.start.column}`
    : `line ${span.start.line}, column ${span.start.column}`;
  lines.push(chalk.dim(`  → ${where}`));

  // Source line + caret. A lexical span sits on one line; an unterminated
  // string runs to the line end, so clamp the underline to the visible text.
  const sourceLine = source.split('\n')[span.start.line - 1] ?? '';
  const endColumn = span.end.line === span.start.line ? span.end.column : sourceLine.length + 1;
  const underline = '^'.repeat(Math.max(1, endColumn - span.start.column));
  const gutter = String(span.start.line);
  const blank = ' '.repeat(gutter.length);
  lines.push(`${chalk.dim(`${gutter} |`)} ${sourceLine}`);
  lines.push(`${chalk.dim(`${blank} |`)} ${' '.repeat(span.start.column - 1)}${chalk.red(underline)}`);

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
