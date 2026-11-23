# @prism/electron-devtools-installer

Installs Chrome extensions, such as React DevTools, into Electron's session in development. It
has the API of the `electron-devtools-installer` package, without that package's use of
Electron's deprecated `session` extension methods: it downloads the extension's CRX file from
the Chrome Web Store, unpacks it (`src/crx.ts`), and has Electron load the unpacked folder.

The main process's `devtools.ts` uses it for windows loaded from the dev server only, so
packaged builds and end-to-end runs never install anything.
