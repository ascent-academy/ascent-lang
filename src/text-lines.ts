// Splits file content into lines the way 'readLines' promises: no trailing
// line terminators, a file ending in a newline doesn't produce a spurious
// empty final line, and an empty file yields zero lines rather than one
// empty one. Shared so terminalHost (a real file) and testHost (an in-memory
// fake) split identically.
export const linesOf = (content: string): string[] => {
  if (content === '') return [];
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};
