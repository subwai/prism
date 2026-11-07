# Architecture

[← Back to the README](../README.md) · [Development](development.md) · [Releasing](releasing.md)

- [Processes and security](#processes-and-security)
- [React Router](#react-router)
- [Renderer](#renderer)
- [Keyboard](#keyboard)
- [Styling](#styling)
- [Photo API](#photo-api)
- [Thumbnails](#thumbnails)
- [Photo index](#photo-index)

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

[React Compiler](https://react.dev/learn/react-compiler) memoizes the renderer's components and
hooks, so they need no `useMemo`, `useCallback` or `memo` of their own. It runs as the Rust port
`@vitejs/plugin-react` offers, which leaves Fast Refresh to React Router's plugin. Components that
render from TanStack Virtual's virtualizer opt out with `'use no memo'`: it changes in place, so
compiled, they would keep the rows they first rendered. The component tests compile components
the same way.

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
to with `useSyncExternalStore`. The library keeps the last few scans that read to the end, so
going back to a folder, or between grid and filmstrip, shows it at once. Changes on disk patch
those kept scans as they do the open one, and a refresh lets them go.

A new view starts from what kept recursive scans list of it, if they read every entry without
errors. A folder inside a kept one is picked out of its entries, so it shows at once with no scan
at all. A recursive view of a folder holding kept ones starts with their entries and asks the
worker to leave those folders out (`excludeDirectoryIds`), reading only the rest. Such a view can
list a folder's contents before the folder itself, so anything that needs a tree from a listing,
such as removing a folder's contents along with it, goes by parents rather than by order.

What individual tiles show, such as thumbnails, folder covers and listings, lives in a
[TanStack Query](https://tanstack.com/query) client that each open folder's `PhotoLibrary` owns.
Loaders are per navigation and fetchers keep no data once unmounted, so React Router has no
shared cache for thousands of tiles that come and go as the grid scrolls. Route loaders read the
same queries (`fetchQuery`) when a navigation should wait for them, and components read them with
`useSuspenseQuery`. Changes on disk patch listings in place and invalidate what changed; a
refresh invalidates everything. Either way, what is on screen stays until fresh data replaces it.

Sorting by name avoids per-file metadata reads; other sorts request metadata. A view sorted
by name and then by date shares one scan: rather than listing the folder again, the scan asks the
worker for the metadata of what it has listed, and of the pages still to come, while the status
bar says it is sorting. Each sort order is computed once per listing and narrowed for searches;
pages a scan streams in are sorted on their own and merged into the sorted list, and metadata
arriving sorts the list afresh. Metadata leaves names as they were, so such a sort keeps the
order by name it had and breaks ties by each entry's place in it, rather than comparing names
again, which takes most of a sort's time.

Filters work like the search: the URL holds them (`filter` shows them; `camera`, `lens` and `tag`
choose),
and the view narrows its sorted list to the photos they match, so a choice applies at once. Showing
the filters reads photos' EXIF details as a sort by date taken does, and their choices are the
values found among what the scan has read so far, growing as details arrive. Once photos have their
details, the search matches their tags as well as their names.

### Virtualization

The tree, grid, filmstrip, and reader are virtualized. Intersection visibility separately gates
thumbnail requests, so overscan does not generate offscreen images, and queued work for entries
that left the viewport waits until they are shown again; the same goes for originals, which the
reader requests for every page it renders. The reader's pages have no known size until they
load, so the virtualizer measures each one as it renders and estimates the rest. A gallery's loader waits up to 100 ms for its
scan's first page and the thumbnails it opens with. A view ready by then, such as a folder read
before, commits with them, so the router's crossfade goes straight to its photos. One that is not
commits anyway with a promise, which `AwaitGallery` shows as the toolbar and a spinner until it
resolves, and then fades in its contents. The spinner itself waits a moment, so a view that
arrives soon after shows none. The filmstrip's loader also waits for its first photo, as the
reader's does for its first pages. A re-sort or refresh of the same folder keeps showing it until the
next is ready instead, as the view defers what it shows. The router aborts only loaders that have
not returned, so the next gallery loader stops the one still reading after it committed.
A folder's cover comes from its own photos, or, failing those, from the shallowest folder inside
it that has any, opening at most 256 folders to find it. The limit counts folders opened rather
than seen, as a breadth-first search sees a whole layer, such as a year of day folders, before
opening any of it.

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
  abandons. A batch holds at least 128 entries, and keeps filling for a few milliseconds while
  entries are at hand, so a large library listed from memory takes a few round trips rather than
  thousands. Recursive scans go breadth first, so the shallowest photos arrive first however deep
  the tree. They read up to 16 folders ahead at once, still listing them in order, as a network
  share takes a round trip per folder, and resolve only the folder they start from: the folders
  found inside it are canonical already. A folder whose listing is known, in memory or in the
  photo index, is listed as soon as the folder holding it is done, rather than in its turn, so a
  scan of a folder holding one read before shows that part at once instead of waiting behind
  folders read from the disk. Folder inspections keep to the order, as they want the shallowest
  covers.
- **Metadata comes later if need be.** A scan can leave out each entry's size and dates, which
  the window then reads for the entries it was given, a chunk at a time. The worker answers only
  for entries a scan listed, without resolving each again, and keeps what it saw so changes to
  them still show. Photos' EXIF details come later the same way, through `readExif`, for a
  sort by date taken.
- **Listings are remembered.** The worker keeps what each folder held when a scan last read it to
  the end, up to a budget of entries, so scanning it again skips the disk. A change drops the
  listings that show it and those of the folders holding it; a folder that goes takes the
  listings inside it along, and a read under way meanwhile is not kept. Complete listings are also
  stored in the [photo index](#photo-index), so they outlast the session.
- **Folder inspection stops early.** A folder's summary comes from its direct children, and its
  cover from them or, breadth first, from the first folder inside with photos or videos. Nothing
  decodes pixels. A change inside a folder makes every folder holding it inspect again, and a
  failed inspection rejects rather than reporting an empty folder. An inspection or listing that
  was under way when its folder changed still answers, but is not remembered, so it cannot
  outlast the change.
- **Changes on disk are pushed**, batched, from the worker's recursive `fs.watch`. A volume that
  unmounts, such as a network share whose connection drops, raises no event, and a watcher started
  before it was mounted again stays silent. So the worker checks every couple of seconds that the
  folder is still the same one, by device and inode, and watches it again, rereading everything,
  when it is not. Listings also drop names the system lists twice, which shares can after
  reconnecting.

The worker also tells the window whether the opened folder is on a network share, which the
sidebar's badge shows. No Electron or Node API says so, so each platform asks in its own way: macOS
reads the `local` flag `mount` lists for the folder's volume, Linux checks the filesystem type from
`statfs`, and Windows takes the UNC paths that mapped drives resolve to as network folders.

Scans skip symlinks and common OS metadata files. The file types Prism shows are listed in
`processes/main/src/photos/media.ts`. Sharp's thumbnail support and Chromium's support for
showing the original are separate, and both can vary by platform.

## Thumbnails

Photo thumbnails are EXIF-oriented WebP images, made by Sharp on a share of the CPU's cores.
Cache keys use the file's inode where the disk reports one, rather than its path, so renaming a
file or folder keeps its thumbnails. They leave out the device number, which the system assigns
afresh each time a volume mounts, so a network share that reconnects or a disk plugged in again
keeps its thumbnails too. Writes are atomic, and the cache is trimmed to a disk budget as it grows.

### Old caches

The thumbnail folder and the photo index are each named for their version, as
`photo-thumbnails-v<version>` and `photo-index-v<version>.db`. Raise the folder's version in
`thumbnail-directory.ts` whenever `thumbnailKey` or the pipeline changes, as the index's follows
its `SCHEMA_VERSION`. Builds of different versions, such as the installed app and a development
branch, then keep caches of their own instead of overwriting each other's. As the app starts, and
once a day while it runs, the main process removes the caches of other versions that nothing has
written to for a month, so an older build still in use keeps its own.

Sharp is external to the bundle, declared in both the main workspace and root application
manifests, and unpacked with its native binaries by electron-builder. The root runtime dependency
is needed for packaged dependency collection; pnpm installs both CPU variants for the macOS
release job.

## Photo index

What the worker reads from inside photos, their EXIF details, is kept in a SQLite database,
`photo-index-v<version>.db` in the app's user data, through Node's built-in `node:sqlite`, so there is no
native module to rebuild for Electron. It is a cache, never the source of truth: a row counts
only while its file has the size and modification time it was read at, and a file is found by
its path or, once renamed or moved, by its device and inode. A database that cannot be opened is
started afresh, and one that cannot be written is kept in memory for the session. It lives
beside the app rather than in the user's folders, which also keeps it off network shares, where
SQLite's locking is unreliable.

Every folder's worker opens the same file in WAL mode, so they read it at once and take turns to
write. Writes are queued and committed together a moment later, and rows nothing used for half a
year are dropped as the index opens. Bump `SCHEMA_VERSION` in `photo-index.ts` whenever what a
row holds changes. Each version has a file of its own, so the installed app and development
builds of other branches, which share the user data folder, keep their own indexes rather than
emptying each other's. Files of other versions are removed once nothing has written to them for
a month.

Scans read EXIF details only when asked to: `exif` in the scan options, which the window sets
when it opens a folder sorted by date taken, or `readExif` for photos a scan already listed, when
the sort changes to it. Either way, at most 16 photos are read at a time, through
[exifr](https://github.com/MikeKovarik/exifr) with a fixed set of tags so it reads only the start
of each file. A photo's tags merge the keywords Windows writes in EXIF (`XPKeywords`), editors
such as Lightroom in XMP (`dc:subject`) and older tools in IPTC, once each whatever their case;
exifr cannot pick fields from XMP, so it reads that segment whole. Listings remember how much they were read with, so one read with EXIF details also
serves scans that ask for less. Changes on disk and renames describe photos with their details, as
any view may sort by them. **File › Reset Photo Details** empties the index, for edits that keep a
file's modification time.

### Stored listings

The index also keeps each folder's complete listings, by the canonical path of the folder opened
and the folder's ID inside it: a row in `folders` for each folder read to the end, with how much
detail it was read with, and a row in `entries` for each entry it held, with its kind, size,
dates and EXIF details as columns. Both are keyed by root and folder, so a folder's entries, and
everything inside a folder, are ranges of the index. Dropping what is inside a folder deletes by
range rather than comparing every row, which matters once a library holds hundreds of thousands
of entries. A scan whose folder the
worker has not read this session, and whose stored listing tells what it asks for, is answered
from the index at once, so a folder opens as fast after a restart as when going back to it.
The folder may have changed while the app was closed, or while a share was unmounted, and no
watcher saw it, so the worker then reads it again behind the scenes, four folders at a time, with
the detail it was stored with. Once the scan has listed every stored entry, the entries that
came, went, changed kind, or changed size or modification time go through the same path as the
watcher's events: the change tracker describes them and the window patches what it shows. A
recursive scan catches up folder by folder as it lists them, which makes reopening a large
library a background walk of `readdir` and `stat` calls that opens only the photos that changed.

A change the watcher sees drops the stored listings that show it, as it does those in memory, and
a refresh, or a change too large to list, drops the library's stored listings altogether.
Closing the folder keeps them. Listings used longest ago are dropped as the index opens, past a
budget of a million entries across every library.
