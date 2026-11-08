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

Components never load data in effects. A gallery shows a **view** the worker holds of the
library: a folder's entries, or for the filmstrip everything inside it, in order and narrowed by
the search and filters (`ViewSpec`). The window never holds a view's entries, only the pages of
it on screen, so a library of a million photos costs it what a screenful does. Route
`clientLoader`s open the view and read its first page, and the folders the tree opens.
`GalleryView` (`data/gallery-view.ts`) follows the view's state, its count and whether it is
still reading, with `useSyncExternalStore`, fed by the worker's `onView` events. Its rows are
TanStack Query data, a page of 256 per query, which the grid, filmstrip and reader read for the
rows they render (`useViewEntries`); a row not read yet holds its place with a shimmering tile.

Each version of a view is a fixed order, so pages read at one fit together. The worker makes a
new version as more of the folder is read, as photos' details come in, and as the disk changes,
and the window then reads again the pages on screen, which keep showing until their new rows
arrive. A read that a new version overtakes reads again rather than being cancelled, as a loader
may be waiting for it. Selection and previews go by ID, so they survive new versions: where an
entry is comes from the worker (`useViewIndex`), found under its new name if it was renamed in
this window, and moving with the keys or the viewer reads the entry it lands on. `KeptViews`
keeps the last six views open, so going back to a folder, or between grid and filmstrip, or
clearing a search a letter at a time, shows each again at once. A grid's preview browses a
second view of the folder's photos and videos, opened only when a photo is previewed.

What individual tiles show, such as thumbnails, folder covers and listings, lives in the same
[TanStack Query](https://tanstack.com/query) client, which each open folder's `PhotoLibrary`
owns. Loaders are per navigation and fetchers keep no data once unmounted, so React Router has
no shared cache for thousands of tiles that come and go as the grid scrolls. Route loaders read
the same queries (`fetchQuery`) when a navigation should wait for them, and components read them
with `useSuspenseQuery`. Changes on disk patch the tree's listings in place and invalidate what
changed, and reach views as new versions; a refresh invalidates everything, and the worker reads
the open views' folders again. Either way, what is on screen stays until fresh data replaces it.

Filters share the search field: what is typed searches names, and the field suggests a format (photo
or video, from each entry's kind) and the cameras, lenses and tags the folder's photos have, which
the worker counts (`viewFacets`), and which become chips (`TokenSearchField`, on Base UI's
combobox). With nothing typed, the list offers the fields with values here instead, and choosing
one swaps the list for its values, with a row back; these steps are rows like any value, so Base
UI's keys reach them. The URL holds both: `q` the text, and repeated `format`, `camera`, `lens`
and `tag` parameters the chips. Values of one field let a photo through if it has any of them,
and the fields together narrow the view. Search, sort and filters are part of the view, so
changing one opens another, which shows once its first page is ready, the old one staying until
then. While the field is focused, `suggest` has the worker read photos' EXIF details at full
speed, as a sort by date taken or a filter by camera, lens or tag does, and the suggestions are
counted again with each version, so they grow as details arrive. With nothing to suggest, the
list says why rather than staying closed. The search matches photos' tags as well as their names.

`useViewParams` applies the changes made in one task together. React Router applies each
`setSearchParams` to the URL as it last rendered, so choosing a suggestion, which adds a chip and
clears the text that found it, would otherwise keep only the second change.

### Virtualization

The tree, grid, filmstrip, and reader are virtualized. Intersection visibility separately gates
thumbnail requests, so overscan does not generate offscreen images, and queued work for entries
that left the viewport waits until they are shown again; the same goes for originals, which the
reader requests for every page it renders. The reader's pages have no known size until they
load, so the virtualizer measures each one as it renders and estimates the rest. A gallery's loader waits up to 100 ms for its
view's first page and the thumbnails it opens with. A view ready by then, such as a folder read
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
Opening a folder gives the window a `MessagePort` to that process, so listings, thumbnails, renames
and change events go straight between them, and the worker checks every argument it receives.
Main handles the folder picker, menus, stills of videos and HEIF photos from the system's
thumbnailer, and the `media:` URLs that serve thumbnails and originals.

A few rules hold across the API:

- **IDs are opaque** and valid only for the folder session that issued them.
- **Folders are read into the catalog.** `listFolder` answers a folder's own entries, folders
  first and then by name, for the sidebar's tree, from the [catalog](#catalog) once the indexer
  has read the folder this session. A folder that cannot be read lists nothing and says why,
  rather than what the catalog last saw of it.
- **Galleries are views.** `openView` gives the window a view of a folder, or of everything
  inside it, sorted, searched and filtered in the worker; `viewRows` reads up to 1024 of its
  rows at a version, `viewIndexOf` finds an entry, `viewFacets` counts what to filter by, and
  `onView` tells of each new version. The worker keeps the current version and the one before,
  so rows asked for as it changes still answer, and closes the oldest of a folder's views past 16. Views are queries of the catalog, so they show what is known at once, and
  grow as their folders are read.
- **Folder inspection stops early.** A folder's summary comes from its direct children in the
  catalog, and its cover from them or, breadth first and by name, from the first folder inside
  with photos or videos, opening at most 256 folders (`worker/inspection.ts`). Nothing decodes
  pixels. A change inside a folder makes every folder holding it inspect again, and a failed
  inspection rejects rather than reporting an empty folder.
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

Folder reads skip symlinks and common OS metadata files. The file types Prism shows are listed in
`processes/main/src/photos/media.ts`. Sharp's thumbnail support and Chromium's support for
showing the original are separate, and both can vary by platform.

## Thumbnails

Photo thumbnails are EXIF-oriented WebP images, made by Sharp on a share of the CPU's cores.
Cache keys use the file's inode where the disk reports one, rather than its path, so renaming a
file or folder keeps its thumbnails. They leave out the device number, which the system assigns
afresh each time a volume mounts, so a network share that reconnects or a disk plugged in again
keeps its thumbnails too. Writes are atomic, and the cache is trimmed to a disk budget as it grows.

### HEIF photos

HEIC and HEIF photos are compressed with HEVC, which neither Sharp's build nor Chromium decodes,
so the system's codecs show them (`processes/main/src/photos/heif.ts`). Their thumbnails come
from Quick Look or the Windows shell, asked for in the photo's own shape, as Quick Look crops to
the box it is given. Both only render small stills, so the viewer is given a full-size JPEG
instead, converted by `sips` on macOS and on Windows by the imaging component, which the
`@prism/windows-imaging` addon calls on a background thread. The
worker keeps the most recent conversions in memory, up to 64 MB, rather than in the thumbnail
cache, where full-size photos would crowd thumbnails out of its budget. Windows decodes HEIF only with the HEIF Image
Extensions and HEVC Video Extensions from the Microsoft Store, and the viewer says so when they
are missing. Other platforms list HEIF photos without showing them.

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

The [catalog](#catalog) of every library, and what was read from inside photos, their EXIF
details, are kept in a SQLite database, `photo-index.db` in the app's user data, through Node's
built-in `node:sqlite`, so there is no native module to rebuild for Electron. It is a cache,
never the source of truth: losing it loses nothing but time. A database that cannot be opened is
started afresh, and one that cannot be written is kept in memory for the session
(`catalog/photo-index.ts`). It lives
beside the app rather than in the user's folders, which also keeps it off network shares, where
SQLite's locking is unreliable.

Every folder's worker opens the same file in WAL mode, so they read it at once and take turns to
write. Its tables change through migrations, which Drizzle applies
as it opens; see [Changing the photo index](development.md#changing-the-photo-index). An index a
newer build migrated further is left for that build, and the session keeps its index in memory,
so the installed app and development builds of other branches, which share the user data folder,
never undo each other's changes. Files of the versions before migrations, such as
`photo-index-v5.db`, are removed once nothing has written to them for a month.

Photos' EXIF details are read in the background, every photo once, so filters and the sort by date
taken cover the whole library: those on screen first, then the rest of the view used last, in its
order, then the rest of the library. The enricher (`enricher.ts`) reads four at a time, and makes
way while thumbnails or originals are being made; while a view needs the details, as a sort by date
taken, a filter by camera, lens or tag, or the search field in use does, it reads 16 at a time and
waits for nothing. What it reads goes into the catalog, so a later session carries on where it
stopped, and only photos that are new, or whose size or modification time changed, are read again.
The status bar of a view that needs them says how many are still to read. A photo a change on disk
or a rename lists afresh has its details recalled or read again in the background, so for a moment a
sort by date taken may show it out of place.

Before reading a photo, the enricher asks the catalog's thread, which owns the EXIF cache
(`catalog/cached-details.ts`). The `exif` table keeps what was read from each file by its absolute
path, across libraries, so a folder opened again as part of another library finds its photos'
details. A row counts only while its file has the size and modification time it was read at, and a
file renamed or moved is found by its device and inode, its row moving with it. Details read from a
file go into the catalog and the cache in one transaction, and rows nothing used for half a year are
dropped as the catalog opens. **File › Reset Photo Details** forgets every photo's details, in the
cache and the catalog, for edits that keep a file's modification time.

Details are read through [exifr](https://github.com/MikeKovarik/exifr) with a fixed set of tags, so
it reads only the start of each file, and closes the file itself, as exifr leaves it open when a
file fails to parse. A photo's tags merge the keywords Windows writes in EXIF (`XPKeywords`),
editors such as Lightroom in XMP (`dc:subject`) and older tools in IPTC, once each whatever their
case; exifr cannot pick fields from XMP, so it reads that segment whole.

### Catalog

The catalog is every entry of every library the app has read, a row each in `items`, so a view
is a query rather than a list anything holds. Its tables are the index's own
(`index-schema.ts`), and it lives on a `worker_threads` thread of its own in each folder's
worker (`catalog-thread.ts`), with its own connection, so a view of a large library never holds
up the thumbnails the worker's own thread answers. Writes queue up and go in transactions of
up to 4096 entries, every quarter of a second, and checkpoint the WAL less often, which writes
a library several times as fast as a transaction a folder would.

Its code, in `processes/main/src/photos/catalog/`, is in two layers. `data/` is the data layer: each
function there is one query, typed through Drizzle, taking the connection and the library it asks
about, and nothing else. The services beside it combine those queries: `writes.ts` applies what the
indexer and enricher send, `cached-details.ts` finds and keeps photos' details in the EXIF cache,
`summaries.ts` answers folder inspections, `views.ts` keeps the open views (narrowing each order
with `narrowing.ts`, and counting what to filter by with `facets.ts`), `details-queue.ts` picks the
photos to read next, and `pruning.ts` drops libraries past the budget. `host.ts` puts them together
on the catalog's thread, and `client.ts` is how the worker's own thread calls it.

- **Views are orders of entry numbers.** Each version is an `Int32Array` of `item`s, 6 MB for
  1.5 million entries, and a page of rows is a lookup by number. Asking SQLite for rows deep
  into a sorted query with `OFFSET` takes a second at that size; a lookup takes milliseconds.
- **Sorts read straight from an index.** Each scope's order by name or date taken comes from
  `items_name` or `items_taken`, gathered with `json_group_array`, in about 100 ms for 1.5
  million entries; the other sorts sort what they read. `grp` leads each index so folders come
  first, names sort by `name_key`, which folds case and accents and pads each run of digits so
  plain comparison sorts them as people read them, and ties go by entry number. A descending view
  reverses each group of its ascending order. The queries name their index, as with one library
  every index looks alike to SQLite, and it picks one that leaves everything to sort.
- **Searches and filters narrow a cached order.** Each scope's order is read once per catalog
  change and shared by its views, which narrow it to the kinds they show and to the entries each
  search and filter lets through, a set read from an index of its own (`items_camera`,
  `item_tags` and so on), rather than one query per combination, which SQLite plans badly.
- **Views are made again as the catalog changes**, at most every half second, or twice as long
  as making one took, so a large one never keeps the thread busy.

The indexer (`indexer.ts`) keeps the catalog true to the disk for what views show. It reads
each folder once a session, breadth first and up to 16 at a time, and writes only what differs
from what the catalog holds, so reopening a library is a walk of `readdir` and `stat` calls that
writes almost nothing, while its views already show it. Views of the same folder share one walk.
A view waits up to 400 ms for its own folder, so a folder read for the first time opens with its
entries rather than empty. Changes the watcher sees are written to the catalog in place, and a
folder that comes, as one moved in does, is read in full. The change tracker asks the catalog
what it knows of entries this session has not listed, rather than holding a map of every entry.
As the index opens, libraries other than the one opening are dropped, those used longest ago
first, past five million entries in all; the one opening is never pruned.
