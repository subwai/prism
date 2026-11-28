# @prism/windows-imaging

A Node addon, written in Rust, that converts photos to JPEG with Windows' imaging component
(WIC), which reads HEIF photos with the codecs from the Microsoft Store. `@prism/media` uses it to
show HEIF photos on Windows; on macOS it uses `sips`, and the addon isn't used.

It runs on libuv's thread pool, the few threads Node keeps for native work, so a conversion
neither starts a process nor holds up the photo worker's JavaScript.

## Layout

`src/` holds the Rust: the call Node sees, which can be stopped with a signal, and the calls to
Windows' imaging component. Node loads the addon through the hand-written `index.js` and
`index.d.ts` at the package's root, which reject on other platforms. Update `index.d.ts` when
the call changes.

## Building

It builds on Windows only: there, `pnpm turbo build -F @prism/windows-imaging` runs Cargo through
[napi-rs](https://napi.rs). On other systems the task does nothing, so working on Prism there
needs no Rust for this package. To type-check its Rust from a Mac, see
[docs/development.md](../../docs/development.md#native-addons). CI builds and tests it on
Windows.
