# @prism/trash

A Node addon, written in Rust, that moves files to the system's Trash and back. Electron's
`shell.trashItem` can't do the second part: it doesn't say where a file landed, and the Trash
renames a file whose name is taken there. This addon returns where each one landed, so Undo
can put it back. The photo worker's `disk/` folder calls it.

## What it covers

| Platform | Where a file goes                                                                      | Through                                     |
| -------- | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| macOS    | the Trash of the file's own volume                                                     | `NSFileManager`                             |
| Windows  | the Recycle Bin                                                                        | the shell's `IFileOperation`                |
| Linux    | the [freedesktop.org Trash](https://specifications.freedesktop.org/trash-spec/latest/) | its own code, which writes the Trash itself |

If a volume has no Trash, the call fails with the system's words. It never deletes a file for
good instead.

## Layout

`src/` holds the Rust: one module with the calls Node sees, and one module per platform, of
which only the system's own is compiled. Node loads the addon through the hand-written
`index.js` and `index.d.ts` at the package's root, so update `index.d.ts` when a call changes.

## Building

`pnpm turbo build -F @prism/trash` runs Cargo through [napi-rs](https://napi.rs) and writes a
`.node` file beside `index.js`; the tests build it first. On macOS it builds for Apple silicon
and Intel and joins the two into one addon with `lipo`. You need Rust;
[docs/development.md](../../docs/development.md#native-addons) says how to install it and how to
type-check the other platforms' code. CI builds and tests it on Windows and Linux, not on macOS, so
run its tests on a Mac after changing the macOS code.
