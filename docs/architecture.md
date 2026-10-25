# Architecture

[← Back to the README](../README.md) · [Development](development.md) · [Releasing](releasing.md)

- [Processes and security](#processes-and-security)
- [React Router](#react-router)
- [Renderer](#renderer)
- [Keyboard](#keyboard)
- [Styling](#styling)
- [Photo API](#photo-api)
- [Thumbnails](#thumbnails)

## Processes and security

The renderer runs sandboxed with context isolation and Node integration disabled. Add privileged
operations as explicit methods in `AppAPI` and the preload bridge, with corresponding
main-process IPC handlers.

The production renderer loads from a local `app:` protocol. Its handler serves assets and falls
back to the SPA shell for page URLs, so browser-history routes and refreshes work. No HTTP server
runs in production.

## React Router

The renderer uses [framework mode in SPA mode](https://reactrouter.com/how-to/spa), with
`clientLoader` and `clientAction` and generated route types. `ssr: false` removes the runtime
server. The small server entry renders the root shell at build time, so keep initial renders free
of browser-only APIs and reach `window.app` only in client loaders or event handlers.

`src/routes.ts` discovers routes with
[remix-flat-routes](https://github.com/kiliman/remix-flat-routes) through React Router's
adapter. Folders ending in `+` group route files, `_layout.tsx` wraps the routes beside it, and
`_index.tsx` is a folder's index route. A leading `_` makes a route pathless.

React Router owns the renderer's Vite config and production build.

## Renderer

### Routes and state

Route modules stay thin, loading and changing data through the preload bridge. The view's state,
such as the folder, search, sort and preview, lives in the URL, so Back closes a preview and
every view can be linked to. Router updates apply at once rather than as transitions
(`entry.client.tsx`), so the previewed photo follows every key press; views that should hold
what they show until the next is ready defer it with `useDeferredValue`. Folder IDs stay opaque.
A page reload returns to the folder picker because filesystem access belongs to the current
session.

### Source layout

`renderer/src/` separates rendering (`components/`), data and IPC helpers (`data/`), and UI hooks
(`hooks/`); `keyboard/` holds the keymap and commands the whole window shares. Each screen or
feature gets a folder in `components/` holding its components and the hooks only they use; what
features share sits at the top of `components/` and in `hooks/`.

### Data

Components never load data in effects. Route `clientLoader`s open the gallery's scan and read the
folders the tree opens; the scan then streams its remaining pages, which the gallery subscribes
to with `useSyncExternalStore`.

What individual tiles show, such as thumbnails, folder covers and listings, lives in a
[TanStack Query](https://tanstack.com/query) client that each open folder's `PhotoLibrary` owns.
Loaders are per navigation and fetchers keep no data once unmounted, so React Router has no
shared cache for thousands of tiles that come and go as the grid scrolls. Route loaders read the
same queries (`fetchQuery`) when a navigation should wait for them, and components read them with
`useSuspenseQuery`. Changes on disk patch listings in place and invalidate what changed; a
refresh invalidates everything. Either way, what is on screen stays until fresh data replaces it.

Sorting by name avoids per-file metadata reads; other sorts request metadata. Each sort order is
computed once per listing and narrowed for searches; pages a scan streams in are sorted on their
own and merged into the sorted list.

### Virtualization

The tree, grid, filmstrip, and reader are virtualized. Intersection visibility separately gates
thumbnail requests, so overscan does not generate offscreen images, and queued work for entries
that left the viewport waits until they are shown again; the same goes for originals, which the
reader requests for every page it renders. The reader's pages have no known size until they
load, so the virtualizer measures each one as it renders and estimates the rest. A navigation waits briefly for the thumbnails it
opens with, so cached ones paint on its first frame while uncached ones fill in afterwards.
Folder covers only inspect immediate children.

## Keyboard

Two files combine into the keymap, as in VS Code. The defaults ship with the app in
`packages/keybindings/src/default-keybindings.jsonc`; the user's `keybindings.json` rules come
after them. For any key the last rule that holds wins, and a command starting with `-` removes
earlier rules for it. Changes apply when the file is saved.

The renderer resolves every key against the keymap; the menu only shows the keys. A command, from
a key or the menu, goes first to what has focus and what holds it, then to the fallbacks of the
frontmost layer (the open sheet, or else the window), so a sheet's keys work wherever focus is
inside it. Components handle commands with `useCommands` on their own element, or
`useGlobalCommands`; `data-keys` and `data-layer-keys` attributes give the keymap's `when`
contexts.

## Styling

Tailwind CSS uses the
[Vite plugin](https://tailwindcss.com/docs/installation/framework-guides/react-router) in the
renderer, with no Tailwind or PostCSS config file. The theme's tokens live in
`@prism/design-system`'s `theme.css`, which the renderer's `src/style.css` imports alongside
Tailwind.

## Photo API

`window.app.photos` exposes folder browsing and on-demand thumbnails; its types are in
`packages/shared/src`. Each open folder has its own utility process, which stops with its window.
Opening a folder gives the window a `MessagePort` to that process, so scans, thumbnails, renames
and change events go straight between them, and the worker checks every argument it receives.
Main handles the folder picker, menus, video stills from the system's thumbnailer, and the
`media:` URLs that serve thumbnails and originals.

A few rules hold across the API:

- **IDs are opaque** and valid only for the folder session that issued them.
- **Scans are lazy.** The window pulls them in batches, one pull at a time, and cancels scans it
  abandons. Recursive scans go breadth first, so the shallowest photos arrive first however deep
  the tree.
- **Folder inspection is shallow.** A folder's cover and summary come only from its direct
  children, without decoding pixels, and a failed inspection rejects rather than reporting an
  empty folder.
- **Changes on disk are pushed**, batched, from the worker's recursive `fs.watch`.

Scans skip symlinks and common OS metadata files. The file types Prism shows are listed in
`processes/main/src/photos/media.ts`. Sharp's thumbnail support and Chromium's support for
showing the original are separate, and both can vary by platform.

## Thumbnails

Photo thumbnails are EXIF-oriented WebP images, made by Sharp on a share of the CPU's cores.
Cache keys use the file's identity on disk where the disk reports one, rather than its path, so
renaming a file or folder keeps its thumbnails. Writes are atomic, and the cache is trimmed to a
disk budget as it grows.

Sharp is external to the bundle, declared in both the main workspace and root application
manifests, and unpacked with its native binaries by electron-builder. The root runtime dependency
is needed for packaged dependency collection; pnpm installs both CPU variants for the macOS
release job.
