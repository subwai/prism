/** `when` conditions: context names combined with `!`, `&&`, `||` and parentheses. */

export type Context = Record<string, boolean>;
export type Condition = (context: Context) => boolean;

/** Compiles a `when` condition, throwing a readable error for one that does not parse. */
export function parseWhen(text: string): Condition {
  const tokens = text.match(/&&|\|\||[!()]|[A-Za-z][\w.]*|\S/gu) ?? [];
  let at = 0;
  function expect(token: string) {
    if (tokens[at] !== token) {
      throw new Error(
        `expected "${token}" ${tokens[at] ? `before "${tokens[at]}"` : 'at the end'}`
      );
    }
    at += 1;
  }
  function primary(): Condition {
    const token = tokens[at];
    at += 1;
    if (token === '!') {
      const inner = primary();
      return (context) => !inner(context);
    }
    if (token === '(') {
      const inner = either();
      expect(')');
      return inner;
    }
    if (token && /^[A-Za-z]/u.test(token)) {
      return (context) => context[token] === true;
    }
    throw new Error(token ? `unexpected "${token}"` : 'unexpected end');
  }
  function both(): Condition {
    let condition = primary();
    while (tokens[at] === '&&') {
      at += 1;
      const [left, right] = [condition, primary()];
      condition = (context) => left(context) && right(context);
    }
    return condition;
  }
  function either(): Condition {
    let condition = both();
    while (tokens[at] === '||') {
      at += 1;
      const [left, right] = [condition, both()];
      condition = (context) => left(context) || right(context);
    }
    return condition;
  }
  const condition = either();
  if (at < tokens.length) {
    throw new Error(`unexpected "${tokens[at]}"`);
  }
  return condition;
}
