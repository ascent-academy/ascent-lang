// messages.ts — the ONLY module that contains user-facing error prose.
//
// Each builder turns a raw {code, span, data} fact into the human parts of a
// Diagnostic: headline, optional teaching paragraph, optional machine-applicable
// fixes. Because spans carry offsets, a builder can read the offending text
// straight out of the source, so most need no `data` at all.
//
// Every message obeys the §9 style contract:
//   1. the compiler takes the blame, never the student ("I found…");
//   2. describe, don't accuse;
//   3. always propose a concrete fix where one exists;
//   4. the message is a micro-lesson — it teaches the rule.

import type { Span, SuggestedFix } from './diagnostic.js';

export interface Built {
  message: string;
  explanation?: string;
  primaryLabel?: string;
  fixes?: SuggestedFix[];
}

type Builder = (text: string, span: Span, data: Record<string, unknown>) => Built;

const q = (s: string) => `'${s}'`;

// Single-character tokens that look like operators from other languages get a
// tailored nudge, keyed by the character the lexer actually found.
const STRAY: Record<string, { why: string; fix: string }> = {
  '!': { why: `Ascent has no '!'. Use '!=' for "is not equal to", or 'not' for boolean negation.`, fix: '!=' },
  '?': { why: `Ascent has no bare '?'. For a default value ("or else"), use '??'.`, fix: '??' },
};

export const MESSAGES: Record<string, Builder> = {
  L0001: (text, span): Built => {
    const stray = STRAY[text];
    if (stray) {
      return {
        message: `I don't recognise ${q(text)} here.`,
        explanation: stray.why,
        fixes: [{ title: `Replace with ${q(stray.fix)}`, edits: [{ span, replacement: stray.fix }] }],
      };
    }
    return { message: `I don't recognise ${q(text)} here.` };
  },

  L0002: (text, span): Built => {
    if (text.startsWith('.')) {
      return {
        message: `This number is missing a digit before the point.`,
        explanation: `Ascent floats need a digit on both sides of the '.', so ${q(text)} must be written ${q('0' + text)}.`,
        fixes: [{ title: `Write ${q('0' + text)}`, edits: [{ span, replacement: '0' + text }] }],
      };
    }
    return {
      message: `${q(text)} isn't a valid number.`,
      explanation: `A number can't run directly into letters — put a space or an operator between them. (Exponent notation like 1e10 isn't supported yet.)`,
    };
  },

  L0003: () => ({
    message: `This block comment is never closed.`,
    explanation: `It opens with '#[' but the file ends before a matching ']#'. Block comments nest, so every '#[' needs its own ']#'.`,
  }),

  L0004: (text) => ({
    message: `${q(text)} isn't a valid escape sequence.`,
    explanation: `Inside a string, '\\' begins an escape. Ascent's escapes are \\" \\\\ \\n \\t \\r.`,
  }),

  L0005: () => ({
    message: `This string is never closed.`,
    explanation: `It opens with a " but reaches the end of the file before a closing ". Add a " to end it.`,
  }),

  // ── S · Syntax ────────────────────────────────────────────────────────────

  S0001: (text, _span, data): Built => {
    const expected = data?.['expected'] as string | undefined;
    const found = text || 'end of file';
    if (expected) {
      return { message: `I expected '${expected}' here, but found ${q(found)}.` };
    }
    return { message: `I didn't expect to find ${q(found)} here.` };
  },

  S0002: (text): Built => {
    const found = text || 'end of file';
    return {
      message: `I expected an expression here, but found ${q(found)}.`,
      explanation: `This position needs a value — a number, a name, a string, or a sub-expression.`,
    };
  },

  S0003: (text): Built => {
    const found = text || 'end of file';
    return {
      message: `I expected ';' to end this statement, but found ${q(found)}.`,
      explanation: `Every statement in Ascent ends with a semicolon.`,
    };
  },

  S0004: (text): Built => {
    const found = text || 'end of file';
    return {
      message: `I expected ')' to close this grouped expression, but found ${q(found)}.`,
      explanation: `Every '(' must be closed with a matching ')'.`,
    };
  },

  S0005: (text): Built => {
    const found = text || 'end of file';
    return {
      message: `I expected a slot name here, but found ${q(found)}.`,
      explanation: `'fix' and 'mut' must be followed by the slot's name, e.g. 'fix count = 0;'.`,
    };
  },

  // ── N · Name & binding ───────────────────────────────────────────────────

  N0001: (text): Built => ({
    message: `I can't find anything named ${q(text)} here.`,
    explanation: `This name hasn't been declared in the current scope. Use 'fix' or 'mut' to create a slot before using it.`,
  }),

  N0002: (text): Built => ({
    message: `I found a second declaration of ${q(text)} in this scope.`,
    explanation: `Each slot name can only be declared once. If you want to update its value, declare it with 'mut' and then assign to it.`,
  }),

  N0003: (text): Built => ({
    message: `I can't assign to ${q(text)} because it was declared with 'fix'.`,
    explanation: `'fix' creates a permanent binding — its value never changes. If you need a slot you can update, use 'mut' instead.`,
  }),

  N0004: (text): Built => ({
    message: `I can't assign to ${q(text)} because it hasn't been declared.`,
    explanation: `To create a slot and set its initial value in one step, write 'mut ${text} = …'. A bare assignment only works on an existing 'mut' slot.`,
  }),

  // ── T · Type ─────────────────────────────────────────────────────────────

  T0003: (_text, _span, data): Built => {
    const type = data['type'] as string | undefined ?? 'Float';
    return {
      message: `I can't use 'div' on a ${type} — 'div' is whole-number division only.`,
      explanation: `'div' divides two Int values and drops the remainder. For Float division, use '/' instead.`,
    };
  },

  T0004: (_text, _span, data): Built => {
    const type = data['type'] as string;
    return {
      message: `I found a ${type} where I expected a Bool.`,
      explanation: `'and', 'or', and 'not' only work with Bool (true / false) values.`,
    };
  },

  T0005: (_text, _span, data): Built => {
    const op       = data['op']       as string;
    const type     = data['type']     as string | undefined;
    const leftType = data['leftType'] as string | undefined;
    const rightType= data['rightType']as string | undefined;
    if (leftType && rightType) {
      return {
        message: `I can't use '${op}' with a ${leftType} and a ${rightType}.`,
        explanation: `The '${op}' operator doesn't support mixing these types.`,
      };
    }
    return {
      message: `I can't apply '${op}' to a ${type ?? 'value'}.`,
      explanation: `The '${op}' operator doesn't work with this type.`,
    };
  },

  // ── R · Runtime ──────────────────────────────────────────────────────────

  R0001: (): Built => ({
    message: `I tried to divide by zero.`,
    explanation: `Division by zero is undefined. Make sure the divisor can never be zero before dividing.`,
  }),

  R0002: (): Built => ({
    message: `This integer operation overflowed 64 bits.`,
    explanation: `Ascent's Int holds whole numbers from −2⁶³ to 2⁶³−1. This result falls outside that range. Consider restructuring the calculation or using Float.`,
  }),
};
