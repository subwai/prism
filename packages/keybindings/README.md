# @prism/keybindings

Prism's keyboard shortcuts, written as VS Code writes its own: rules that bind a key to a
command, optionally only `when` a condition holds. The defaults come first and the user's
`keybindings.json` after, and for any key press the last rule that matches wins. The main
process uses it for the menu bar and the user's file, and the window for the keys themselves.

## Layout

| File                            | What it holds                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/default-keybindings.jsonc` | The default rules. The main process shows them, read-only, beside the user's file.                  |
| `src/keymap.ts`                 | Every command and `when` context, and the keymap built from the rules: which command a key runs.    |
| `src/keys.ts`                   | Keys as rules write them (`cmd+shift+f`), as key presses arrive, and as menus and people read them. |
| `src/when.ts`                   | Reading a `when` condition: context names joined with `!`, `&&`, `\|\|` and parentheses.            |
| `src/file.ts`                   | Reading a `keybindings.json`, which allows comments and trailing commas.                            |
| `src/template.ts`               | The text of a new `keybindings.json`, with notes on writing rules.                                  |
| `src/index.ts`                  | The package's exports.                                                                              |

## Rules

- **No Node, no Electron, no React.** The main process, the preload and the window all import it,
  so it is plain TypeScript that runs anywhere.
- **A new command** goes in `COMMANDS` in `keymap.ts`, with the words the settings file shows for
  it, and gets its default key in `default-keybindings.jsonc`. The component it belongs to
  handles it, as the window's `keyboard/commands.ts` explains, and the menu bar shows it if
  `processes/main/src/menu.ts` lists it.
- **A new `when` context** goes in `CONTEXTS` in `keymap.ts`. The window marks the element where
  it holds with `data-keys` (while focus is inside it) or `data-layer-keys` (anywhere in that
  layer), as `collection.tsx` does with `listFocus`.
- **Defaults are written for macOS.** Elsewhere, `ctrl` stands in for `cmd`.
