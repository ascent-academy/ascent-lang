import type { Span } from '../lexer/token.js';
import type { BinaryOp } from '../parser/ast.js';
import { RuntimeError } from '../errors/runtime-error.js';
import {
  isNumeric, asFloat, valuesEqual,
  intVal, floatVal, boolVal,
  type RuntimeValue,
} from './values.js';

// The numeric law (design.md §4/§5): the trap semantics for Int and Float,
// kept in one place so the invariants (R0001–R0004) read uninterrupted by the
// tree walk. Every arithmetic result flows through an overflow or finiteness
// guard before it becomes a value.

// Int is a 64-bit signed whole number (design.md §4): it traps on overflow
// rather than silently wrapping around.
const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 63n - 1n;

export const checkIntOverflow = (value: bigint, span: Span): bigint => {
  if (value < INT_MIN || value > INT_MAX) {
    throw new RuntimeError({ code: 'R0001', span });
  }
  return value;
};

// Every Float is a real, ordered number (design.md §4) — NaN/Infinity never
// exist as a value, so any operation that would produce one crashes instead.
export const checkFiniteFloat = (value: number, span: Span): number => {
  if (!Number.isFinite(value)) {
    throw new RuntimeError({ code: 'R0004', span });
  }
  return value;
};

// BigInt's own '%' truncates toward zero (remainder takes the sign of
// the dividend, like C/Java/JS). 'mod' instead floors — the result
// takes the sign of the divisor — so a single correction pass covers
// the case where the truncating remainder landed on the wrong side of
// zero. 'div' is then defined from 'mod' so the identity
// `(a div b) * b + (a mod b) == a` holds by construction.
const floorDivMod = (a: bigint, b: bigint): { div: bigint; mod: bigint } => {
  let mod = a % b;
  if (mod !== 0n && (mod < 0n) !== (b < 0n)) mod += b;
  return { div: (a - mod) / b, mod };
};

// A pure function of the operator, the two operand values, and two spans: the
// whole expression's `span` (where an overflow/non-finite *result* is
// reported) and the right operand's `rightSpan` (where a zero divisor or
// negative exponent — a fact about that operand's value — is reported). No
// env, no tree walk. 'and'/'or' never reach here: the evaluator short-circuits
// them before the operands are both evaluated.
export const evaluateBinary = (
  op: BinaryOp, left: RuntimeValue, right: RuntimeValue, span: Span, rightSpan: Span,
): RuntimeValue => {
  if (op === '==' || op === '!=') {
    const eq = valuesEqual(left, right);
    return boolVal(op === '==' ? eq : !eq);
  }

  if (!isNumeric(left) || !isNumeric(right)) throw new Error(`internal: '${op}' on non-numeric`);

  if (op === '<' || op === '<=' || op === '>' || op === '>=') {
    const useInt = left.type === 'Int' && right.type === 'Int';
    const l = useInt ? left.value : asFloat(left);
    const r = useInt ? right.value : asFloat(right);
    const result = op === '<' ? l < r : op === '<=' ? l <= r : op === '>' ? l > r : l >= r;
    return boolVal(result);
  }

  if (op === 'div' || op === 'mod') {
    if (left.type !== 'Int' || right.type !== 'Int') throw new Error(`internal: '${op}' on non-Int`);
    if (right.value === 0n) throw new RuntimeError({ code: 'R0002', span: rightSpan });
    const { div, mod } = floorDivMod(left.value, right.value);
    // INT_MIN div -1 is the one 'div'/'mod' case that can overflow: its exact
    // result (INT_MAX + 1) has no representable Int.
    return intVal(checkIntOverflow(op === 'div' ? div : mod, span));
  }

  if (op === '/') {
    const divisor = asFloat(right);
    if (divisor === 0) throw new RuntimeError({ code: 'R0002', span: rightSpan });
    return floatVal(checkFiniteFloat(asFloat(left) / divisor, span));
  }

  if (op === '**') {
    if (left.type === 'Int' && right.type === 'Int') {
      // The result type is fixed at Int ** Int -> Int regardless of the
      // exponent's runtime sign (§5), so a negative exponent — which would
      // need a fractional result — can't be silently truncated; it crashes.
      if (right.value < 0n) {
        throw new RuntimeError({ code: 'R0003', span: rightSpan });
      }
      return intVal(checkIntOverflow(left.value ** right.value, span));
    }
    return floatVal(checkFiniteFloat(Math.pow(asFloat(left), asFloat(right)), span));
  }

  if (left.type === 'Int' && right.type === 'Int') {
    const v = op === '+' ? left.value + right.value
      : op === '-' ? left.value - right.value
        : left.value * right.value;
    return intVal(checkIntOverflow(v, span));
  }

  const l = asFloat(left);
  const r = asFloat(right);
  const v = op === '+' ? l + r : op === '-' ? l - r : l * r;
  return floatVal(checkFiniteFloat(v, span));
};
