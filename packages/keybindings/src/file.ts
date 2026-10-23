import { parse, type ParseError, printParseErrorCode, stripComments } from 'jsonc-parser';

/**
 * Reads `text` as a keybindings file, which allows comments and trailing commas as VS Code's
 * does: its rules, or what keeps it from being read.
 */
export function readKeybindings(text: string): { rules: unknown; error: string | null } {
  // A file that is empty, or only comments, holds no rules.
  if (stripComments(text).trim() === '') {
    return { error: null, rules: [] };
  }
  const errors: ParseError[] = [];
  const rules: unknown = parse(text, errors, { allowTrailingComma: true });
  const [first] = errors;
  if (first) {
    const line = text.slice(0, first.offset).split('\n').length;
    return { error: `${printParseErrorCode(first.error)} on line ${line}`, rules: [] };
  }
  return { error: null, rules };
}
