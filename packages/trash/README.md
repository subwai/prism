# @prism/trash

A Node addon, written in Rust, that moves files to the system's Trash and back. Electron's
`shell.trashItem` can't do the second part: it doesn't say where a file landed, and the Trash
renames a file whose name is taken there. This addon returns where each one landed, so Undo
can put it back. The photo worker calls it from `disk/trash/system-trash.ts`.

## What it covers

| Platform | Where a file goes                                                                      | Through                                     |
| -------- | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| macOS    | the Trash of the file's own volume                                                     | `NSFileManager`                             |
| Windows  | the Recycle Bin                                                                        | the shell's `IFileOperation`                |
| Linux    | the [freedesktop.org Trash](https://specifications.freedesktop.org/trash-spec/latest/) | its own code, which writes the Trash itself |

If a volume has no Trash, the call fails with the system's words. It never deletes a file for
good instead.

## Layout

| File                                             | What it holds                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `src/lib.rs`                                     | The two calls Node sees, `trashItem` and `restoreItem`, and which platform runs. |
| `src/macos.rs`, `src/windows.rs`, `src/linux.rs` | One platform each. Only the system's own one is compiled.                        |
| `index.js`, `index.d.ts`                         | What Node imports: loads the addon built for this system, and its types.         |
| `scripts/build.ts`                               | The `build` task.                                                                |

`index.d.ts` is written by hand, not generated, so update it when a call changes.

## Building

`pnpm turbo build -F @prism/trash` runs Cargo through [napi-rs](https://napi.rs) and writes a
`.node` file beside `index.js`; the tests build it first. On macOS it builds for Apple silicon
and Intel and joins the two into one `trash.darwin-universal.node` with `lipo`. You need Rust;
[docs/development.md](../../docs/development.md#native-addons) says how to install it and how to
type-check the other platforms' code. CI builds and tests it on Windows and Linux, not on macOS, so
run its tests on a Mac after changing `macos.rs`.
