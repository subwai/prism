import { COMMANDS, CONTEXTS } from '#keymap';

function list(entries: Record<string, string>) {
  const width = Math.max(...Object.keys(entries).map((name) => name.length));
  return Object.entries(entries).map(([name, text]) => `//   ${name.padEnd(width)}  ${text}`);
}

/** A new `keybindings.json`: no rules yet, with notes on writing them. */
export function keybindingsTemplate() {
  return [
    '// Your keyboard shortcuts, written as in VS Code. They apply after the defaults, which are',
    '// in default-keybindings.jsonc next to this file (File > Default Keyboard Shortcuts): for',
    '// any key, the last rule that holds wins. Each rule binds a key to a command, and can apply',
    '// only `when` a condition holds. A command starting with "-" removes the defaults for it,',
    '// or only those with the key (and condition) given. Changes apply when you save.',
    '//',
    '// Keys: modifiers (cmd, ctrl, alt, shift) joined to a key with "+", such as "cmd+shift+f",',
    '// "shift+right", "space" or "m".',
    '//',
    '// Commands:',
    ...list(COMMANDS),
    '//',
    '// Conditions, combined with !, && and || and grouped with parentheses:',
    ...list(CONTEXTS),
    '[',
    '  // { "key": "n", "command": "next", "when": "viewerFocus" }',
    ']',
    ''
  ].join('\n');
}
