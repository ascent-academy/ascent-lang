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
};
