# @prism/keybindings

Prism's keyboard shortcuts, written as VS Code writes its own: rules that bind a key to a
command, optionally only `when` a condition holds. The defaults come first and the user's
`keybindings.json` after, and for any key press the last rule that matches wins. The main
process uses it for the menu bar and the user's file, and the window for the keys themselves.

## Layout

`src/` is flat, a module for each part of the rules: the commands and contexts, keys and how
they are written, `when` conditions, and reading a `keybindings.json`. The default rules are
`src/default-keybindings.jsonc`, which the main process shows read-only beside the user's file.
Everything else imports from the package's entry, `src/index.ts`.

## Rules

- **No Node, no Electron, no React.** The main process, the preload and the window all import it,
  so it is plain TypeScript that runs anywhere.
- **A new command** goes in the list of commands, with the words the settings file shows for it,
  and gets its default key in the default rules. The component it belongs to handles it, through
  the window's `keyboard/` folder, and the menu bar shows it if the main process's menu lists it.
- **A new `when` context** goes in the list of contexts. The window marks the element where it
  holds with `data-keys` (while focus is inside it) or `data-layer-keys` (anywhere in that
  layer).
- **Defaults are written for macOS.** Elsewhere, `ctrl` stands in for `cmd`.
