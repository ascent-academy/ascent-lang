import assert from 'node:assert/strict';
import { Lexer } from '../../src/lexer/index.js';
import type { TokenKind } from '../../src/lexer/token.js';

function kinds(src: string): TokenKind[] {
  return new Lexer(src).tokenize().tokens.map((tok) => tok.kind);
}

describe('Lexer', () => {
  it('tokenizes an empty source as just EOF', () => {
    assert.deepEqual(kinds(''), ['EOF']);
  });

  it('tokenizes integer and float literals', () => {
    assert.deepEqual(kinds('42 3.14'), ['INT_LIT', 'FLOAT_LIT', 'EOF']);
  });

  it('tokenizes a string literal', () => {
    const [tok] = new Lexer('"hello"').tokenize().tokens;
    assert.equal(tok?.kind, 'STR_LIT');
    assert.equal(tok?.value, 'hello');
  });

  it('tokenizes keywords and slots', () => {
    assert.deepEqual(kinds('fix x = 1'), ['KW_FIX', 'SLOT', 'EQUALS', 'INT_LIT', 'EOF']);
  });

  it('tokenizes built-in constructors and type names', () => {
    assert.deepEqual(kinds('True Int'), ['BOOL_LIT', 'TYPE_NAME', 'EOF']);
  });

  it('tokenizes operators and punctuation', () => {
    assert.deepEqual(kinds('== != <= >= ( ) { }'), [
      'EQ_EQ', 'BANG_EQ', 'LT_EQ', 'GT_EQ', 'LPAREN', 'RPAREN', 'LBRACE', 'RBRACE', 'EOF',
    ]);
  });

  it('reports an error marker for an unrecognised character', () => {
    const { tokens, errorMarkers } = new Lexer('$').tokenize();
    assert.equal(tokens[0]?.kind, 'ERROR');
    assert.equal(errorMarkers[0]?.code, 'L0001');
  });
});
