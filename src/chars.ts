export const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';

export const isAlpha = (ch: string): boolean =>
  (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';

export const isAlphaNum = (ch: string): boolean => isAlpha(ch) || isDigit(ch);

export const isUpper = (ch: string): boolean => ch >= 'A' && ch <= 'Z';

export const isWhitespace = (ch: string): boolean => (
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
);
