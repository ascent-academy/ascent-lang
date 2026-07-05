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

  it('tokenizes ** as a single STAR_STAR token, not two STARs', () => {
    assert.deepEqual(kinds('2 ** 3'), ['INT_LIT', 'STAR_STAR', 'INT_LIT', 'EOF']);
  });

  it('tokenizes a lone * as STAR', () => {
    assert.deepEqual(kinds('2 * 3'), ['INT_LIT', 'STAR', 'INT_LIT', 'EOF']);
  });

  it('reports an error marker for an unrecognised character', () => {
    const { tokens, errorMarkers } = new Lexer('$').tokenize();
    assert.equal(tokens[0]?.kind, 'ERROR');
    assert.equal(errorMarkers[0]?.code, 'L0001');
  });

  it('resolves an identifier starting with a keyword to a SLOT', () => {
    assert.deepEqual(kinds('divide'), ['SLOT', 'EOF']);
  });

  it('does not consume a dot into a number when no digit follows', () => {
    assert.deepEqual(kinds('3.method()'), [
      'INT_LIT', 'DOT', 'SLOT', 'LPAREN', 'RPAREN', 'EOF',
    ]);
  });

  it('resolves escape sequences in a string literal', () => {
    const [tok] = new Lexer(String.raw`"a\nb\tc\\d\"e"`).tokenize().tokens;
    assert.equal(tok?.kind, 'STR_LIT');
    assert.equal(tok?.value, 'a\nb\tc\\d"e');
  });

  it('reports L0001 for an unknown escape sequence in a string', () => {
    const { tokens, errorMarkers } = new Lexer(String.raw`"\q"`).tokenize();
    assert.equal(tokens[0]?.kind, 'ERROR');
    assert.equal(errorMarkers[0]?.code, 'L0001');
  });

  it('reports L0003 for a string unterminated at EOF', () => {
    const { tokens, errorMarkers } = new Lexer('"abc').tokenize();
    assert.equal(tokens[0]?.kind, 'ERROR');
    assert.equal(errorMarkers[0]?.code, 'L0003');
  });

  it('reports L0003 for a string unterminated at a newline', () => {
    const { tokens, errorMarkers } = new Lexer('"abc\ndef"').tokenize();
    assert.equal(tokens[0]?.kind, 'ERROR');
    assert.equal(errorMarkers[0]?.code, 'L0003');
  });

  it('reports L0002 for a number glued to a letter', () => {
    const { tokens, errorMarkers } = new Lexer('123abc').tokenize();
    assert.equal(tokens[0]?.kind, 'ERROR');
    assert.equal(errorMarkers[0]?.code, 'L0002');
  });

  it('reports L0004 for a leading-dot float', () => {
    const { tokens, errorMarkers } = new Lexer('.5').tokenize();
    assert.equal(tokens[0]?.kind, 'ERROR');
    assert.equal(errorMarkers[0]?.code, 'L0004');
  });

  it('skips a line comment running to end of line', () => {
    assert.deepEqual(kinds('1 # this is a comment\n2'), ['INT_LIT', 'INT_LIT', 'EOF']);
  });

  it('skips a line comment with nothing after it', () => {
    assert.deepEqual(kinds('1 # trailing comment'), ['INT_LIT', 'EOF']);
  });

  it('skips a whole-line comment', () => {
    assert.deepEqual(kinds('# a whole line\n1'), ['INT_LIT', 'EOF']);
  });

  it('skips a mid-line block comment', () => {
    assert.deepEqual(kinds('1 #[ comment ]# + 2'), ['INT_LIT', 'PLUS', 'INT_LIT', 'EOF']);
  });

  it('skips a block comment spanning multiple lines', () => {
    assert.deepEqual(kinds('1 #[ line one\nline two ]# + 2'), ['INT_LIT', 'PLUS', 'INT_LIT', 'EOF']);
  });

  it('skips a nested block comment', () => {
    assert.deepEqual(kinds('1 #[ outer #[ inner ]# still outer ]# + 2'), [
      'INT_LIT', 'PLUS', 'INT_LIT', 'EOF',
    ]);
  });

  it('reports L0005 for a block comment unterminated at EOF', () => {
    const { tokens, errorMarkers } = new Lexer('1 #[ never closed').tokenize();
    assert.equal(tokens[0]?.kind, 'INT_LIT');
    assert.equal(tokens[1]?.kind, 'EOF');
    assert.equal(errorMarkers[0]?.code, 'L0005');
  });

  it('reports L0005 for a nested block comment missing its outer close', () => {
    const { errorMarkers } = new Lexer('#[ outer #[ inner ]# unclosed').tokenize();
    assert.equal(errorMarkers[0]?.code, 'L0005');
  });
});
