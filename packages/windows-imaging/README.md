# @prism/windows-imaging

A Node addon, written in Rust, that converts photos to JPEG with Windows' imaging component
(WIC), which reads HEIF photos with the codecs from the Microsoft Store. `@prism/media` uses it to
show HEIF photos on Windows (`heif.ts`); on macOS it uses `sips`, and the addon isn't used.

It runs on libuv's thread pool, the few threads Node keeps for native work, so a conversion
neither starts a process nor holds up the photo worker's JavaScript.

## Layout

| File                     | What it holds                                                              |
| ------------------------ | -------------------------------------------------------------------------- |
| `src/lib.rs`             | The call Node sees, `convertToJpeg`, which can be stopped with a signal.   |
| `src/wic.rs`             | The calls to Windows' imaging component.                                   |
| `index.js`, `index.d.ts` | What Node imports. Elsewhere than Windows, `convertToJpeg` always rejects. |
| `scripts/build.ts`       | The `build` task.                                                          |

`index.d.ts` is written by hand, not generated, so update it when the call changes.

## Building

It builds on Windows only: there, `pnpm turbo build -F @prism/windows-imaging` runs Cargo through
[napi-rs](https://napi.rs). On other systems the task does nothing, so working on Prism there
needs no Rust for this package. To type-check its Rust from a Mac, see
[docs/development.md](../../docs/development.md#native-addons). CI builds and tests it on
Windows.
