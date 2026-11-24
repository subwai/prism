# @prism/preload

The bridge between the window and the rest of the app. It runs in the window before the page
does, with access to Electron's IPC, and hands the page one object, `globalThis.app`, with
everything the page may ask of the main process and the photo worker. The page itself has no
access to Node or Electron.

## Layout

| File                   | What it holds                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `src/index.ts`         | Builds `globalThis.app` and hands it to the page with `contextBridge`.                          |
| `src/photos.ts`        | The library and Trash parts of it: calls to the photo worker, and the updates the worker sends. |
| `src/ipc-listeners.ts` | Subscribing to what the main process sends on a channel, with a function that unsubscribes.     |

When a folder opens, the main process hands the preload a message port to that folder's photo
worker, and from then on the window calls the worker straight through it, not through the main
process.

## Rules

- **The shape of `globalThis.app` is `AppAPI`, in `@prism/shared`,** with the channel names. Change
  the type there first, then add the call here, and the page and the main process follow.
- **Keep it thin.** Each part of the API sends a message and passes on the answer, or passes
  updates on to the page's listeners. What a call does is decided in the main process or the
  worker, and what the page shows in the renderer.
- **It's one CommonJS file.** A sandboxed preload can't load other files, so the build bundles
  everything it imports into `index.cjs`. It has no Node, so it imports `@prism/shared`'s main
  entry, never a Node-only one such as `@prism/shared/sqlite`.
