import { Lexer } from './lexer';

const src = '1 + 2 * 3';
const lexer = new Lexer(src);
const result = lexer.tokenize();

console.log(result.tokens);
console.log(result.diagnostics);
