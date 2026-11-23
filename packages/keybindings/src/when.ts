/** `when` conditions: context names combined with `!`, `&&`, `||` and parentheses. */

export type Context = Record<string, boolean>;
export type Condition = (context: Context) => boolean;

/**
 * Turns a `when` condition into a function, throwing a readable error for one that does not
 * parse. It reads the text left to right, one token at a time. As in code, `&&` groups more
 * tightly than `||`, so `a || b && c` means `a || (b && c)`.
 */
export function parseWhen(text: string): Condition {
  const tokens = text.match(/&&|\|\||[!()]|[A-Za-z][\w.]*|\S/gu) ?? [];
  let position = 0;
  function expectToken(token: string) {
    if (tokens[position] !== token) {
      throw new Error(
        `expected "${token}" ${tokens[position] ? `before "${tokens[position]}"` : 'at the end'}`,
      );
    }
    position += 1;
  }
  // One context name, a `!` before one, or a condition in parentheses.
  function readTerm(): Condition {
    const token = tokens[position];
    position += 1;
    if (token === '!') {
      const inner = readTerm();
      return (context) => !inner(context);
    }
    if (token === '(') {
      const inner = readAnyOf();
      expectToken(')');
      return inner;
    }
    if (token && /^[A-Za-z]/u.test(token)) {
      return (context) => context[token] === true;
    }
    throw new Error(token ? `unexpected "${token}"` : 'unexpected end');
  }
  // Terms joined by `&&`.
  function readAllOf(): Condition {
    let condition = readTerm();
    while (tokens[position] === '&&') {
      position += 1;
      const [left, right] = [condition, readTerm()];
      condition = (context) => left(context) && right(context);
    }
    return condition;
  }
  // `&&` groups joined by `||`.
  function readAnyOf(): Condition {
    let condition = readAllOf();
    while (tokens[position] === '||') {
      position += 1;
      const [left, right] = [condition, readAllOf()];
      condition = (context) => left(context) || right(context);
    }
    return condition;
  }
  const condition = readAnyOf();
  if (position < tokens.length) {
    throw new Error(`unexpected "${tokens[position]}"`);
  }
  return condition;
}
