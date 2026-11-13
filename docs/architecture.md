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
- [Ratings](#ratings)
- [Moving to the Trash](#moving-to-the-trash)

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
the same way. The compiler takes a function for a hook only if it calls one, and skips a hook
that uses TanStack Virtual, so those two kinds keep their own `useCallback` where what they
return must stay the same, as a ref callback must (`use-idle-pointer.ts`, `use-grid-layout.ts`).

## Renderer

### Routes and state

Route modules stay thin, loading and changing data through the preload bridge. The view's state,
such as the folder, search, sort and preview, lives in the URL, so Back closes a preview and
every view can be linked to. Router updates apply at once rather than as transitions
(`entry.client.tsx`), so the previewed photo follows every key press; views that should hold
what they show until the next is ready defer it with `useDeferredValue`. Folder IDs stay opaque.
A page reload returns to the folder picker because filesystem access belongs to the current
session. The sizes set with sliders and panes' edges are not part of a view, so they live in
`data/layout-preferences.ts` instead, saved to local storage (`data/stored-preferences.ts`),
which the window reads at once on a reload or the next launch, so a view's first frame has
them; whether videos play muted, and how loud, is kept the same way (`data/viewer-preferences.ts`). The URL
is lost when the app quits, so the gallery's loader also remembers the view it opens
(`data/last-view.ts`): its mode and sort in local storage, for whichever folder opens next, and
its folder in the main process, by the open folder's path, in `current-folders.json`. Opening a
folder, or reopening the last one on launch, starts from that view. The folders the tree opened
or closed by hand are the folder's own, and their IDs the main process's to read, so it keeps
them the same way, in `opened-folders.json` (both through `photos/main/per-folder-file.ts`).
The library layout's loader reads them, and the listings of those the tree shows and of the
current folder's ancestors, before its first frame. It waits 100 ms for the opened folders'
listings, as a gallery does for its view: a tree with thousands of folders open, or on a slow
share, commits without the rest, which the tree reads and shows as they arrive. The main process keeps the window's size
and place, maximized or full screen, in `window-state.json` (`window-state.ts`), read before
the window is made so it opens there. Closing to restart into an update also keeps the page it
showed, its path and query, which the next launch loads instead of the start page.

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
still reading, with `useSyncExternalStore`, fed by the worker's `onUpdate` events. Its rows are
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
[TanStack Query](https://tanstack.com/query) client, which each open folder's `LibrarySession`
owns. Loaders are per navigation and fetchers keep no data once unmounted, so React Router has
no shared cache for thousands of tiles that come and go as the grid scrolls. Route loaders read
the same queries (`fetchQuery`) when a navigation should wait for them, and components read them
with `useSuspenseQuery`. Tree rows, folder covers, thumbnails being made and the viewer's
originals read theirs with `useQuery` instead: React holds back a Suspense boundary's content for
up to 300 ms after its fallback shows, which kept covers answered in a few milliseconds off screen
that long, and the viewer's last photo after an arrow key held down. Nothing
the window holds is patched: changes on disk invalidate the listings and covers they touch, which
are read again from the catalog, and reach views as new versions; a refresh invalidates everything, and the worker reads
the open views' folders again. A view's pages, places and facets name the version they were read
at in their query keys, so a new version is new queries rather than invalidated ones, and each
page's last read shows as placeholder data until the new one arrives. Either way, what is on
screen stays until fresh data replaces it.

Filters share the search field: what is typed searches names, and the field suggests a format (photo
or video, from each entry's kind) and the cameras, lenses and tags the folder's photos have, which
the worker counts (`viewFacets`), and which become chips (`TokenSearchField`, on Base UI's
combobox). The counts are of the folder, whatever the search and filters, so each key typed opens
a new view whose counts the last view's stand in for until counted: an empty list would drop
Base UI's highlight, which comes back only with the next key. With nothing typed, the list offers the fields with values here instead, and choosing
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
load, so the virtualizer measures each one as it renders and estimates the rest. When the filmstrip's thumbnails change size, `use-grid-layout.ts` moves its scroll offset so the card in the middle stays there, or the strip stays at whichever end it was scrolled to, since a fixed offset would land somewhere else in the list at the new size. A gallery's loader waits up to 100 ms for its
view's first page and the thumbnails it opens with. A view ready by then, such as a folder read
before, commits with them, so the router's crossfade goes straight to its photos. One that is not
commits anyway with a promise, which `AwaitGallery` shows as the toolbar and a spinner until it
resolves, and then fades in its contents. The spinner itself waits a moment, so a view that
arrives soon after shows none. The filmstrip's loader also waits for its first photo, as the
reader's does for its first pages, unless it is HEIF or TIFF: converting one takes longer than a view
should wait, so the viewer shows its thumbnail, scaled up, until the photo is ready. A re-sort or refresh of the same folder keeps showing it until the
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

`window.app.photos` exposes folder browsing and on-demand thumbnails, and `window.app.trash`
planning and running moves to the Trash, over the same connection to the folder's worker; their
types are in `packages/shared/src`. Each open folder has its own utility process, which stops with its window.
Opening a folder gives the window a `MessagePort` to that process, so listings, thumbnails, renames
and change events go straight between them, and the worker checks every argument it receives.
Main handles the folder picker, menus, stills of videos from the system's thumbnailer, and the `media:` URLs that serve thumbnails and originals.

The code lives in `processes/main/src/photos/`, a folder for each place it runs: `main/` in the
main process (the IPC handlers, the `media:` protocol, the folder sessions and the client that
starts each worker), `worker/` in the folder's utility process (the library, its views, the
indexer, enricher and watcher), and `errors.ts` and `validate.ts` are shared by both. Two packages
hold the rest: `@prism/catalog`, in `packages/catalog`, is the [catalog](#catalog), which runs on
a thread of its own, and `@prism/media`, in `packages/media`, reads photos and videos (file types,
thumbnails, conversions of the photos Chromium cannot show, and EXIF). Tests sit in a `__tests__/` folder beside the code they cover.

A few rules hold across the API:

- **IDs are opaque** and valid only for the folder session that issued them.
- **Folders are read into the catalog.** `listFolder` answers a folder's own entries, folders
  first and then by name, for the sidebar's tree, from the [catalog](#catalog) once the indexer
  has read the folder this session. A folder that cannot be read lists nothing and says why,
  rather than what the catalog last saw of it, and whether it is `missing`: nothing is there
  any more. While the opened folder itself is missing, the library layout shows that in place
  of the tree and the gallery, until the watcher's checks find it back and read it again.
- **Galleries are views.** `openView` gives the window a view of a folder, or of everything
  inside it, sorted, searched and filtered in the worker; `viewRows` reads up to 1024 of its
  rows at a version, `viewIndexOf` finds an entry, `viewFacets` counts what to filter by, `viewErrors`
  lists what could not be read, which a view's state only counts, and `onUpdate` tells of each
  new version. The worker keeps the current version and the one before,
  so rows asked for as it changes still answer, and closes the oldest of a folder's views past 16. Views are queries of the catalog, so they show what is known at once, and
  grow as their folders are read. Rows and places asked for at a version the worker has let go
  come back as `null`, not as an empty page or -1, and the window asks again at the newest. An
  entry's place is asked once at each version.
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
- **A change reaches the window once, in order.** For each batch the worker first tells which
  entries' contents are out of date (`onStale`), so thumbnails and the open original are read
  again at once. It then writes the batch to the catalog, makes the open views again, and tells
  the changes and those versions together (`onUpdate`); versions the catalog makes meanwhile are
  held back. The window marks the listings they touch stale, then hands views their versions, so
  a version never arrives before the changes it holds. Versions made as folders and photos' details are read
  come the same way, without changes. Making the versions at once costs a change a few tens of
  milliseconds in a library of 200,000 photos, and up to a few hundred while one is being read.

The worker also tells the window whether the opened folder is on a network share, which the
sidebar's badge shows. No Electron or Node API says so, so each platform asks in its own way: macOS
reads the `local` flag `mount` lists for the folder's volume, Linux checks the filesystem type from
`statfs`, and Windows takes the UNC paths that mapped drives resolve to as network folders.

Folder reads skip symlinks and common OS metadata files. The file types Prism shows are listed in
`packages/media/src/kinds.ts`. Sharp's thumbnail support and Chromium's support for
showing the original are separate, and both can vary by platform.

## Thumbnails

Photo thumbnails are EXIF-oriented WebP images, made by Sharp on a share of the CPU's cores.
They are converted to Display P3 and tagged with it rather than flattened to sRGB, so a
wide-gamut photo's thumbnail matches the original the viewer swaps it for. A photo cut short gets
a thumbnail of what can be read, as Chromium shows such a JPEG (`DECODING` in `thumbnails.ts`).
Sharp runs on libuv's thread pool, which every asynchronous file call shares, so the main process
starts each worker with `UV_THREADPOOL_SIZE` set to its decodes, the indexer's file calls and a
few spare threads (`packages/media/src/threads.ts`). With libuv's default of 4, finding a cached
thumbnail waited behind the decodes. The indexer makes no more file calls at once than it has
threads (`read-folder.ts`): libuv's queue is first in, first out, so the thousand `stat` calls
it used to queue while reading a network share kept each cached thumbnail's waiting for
seconds. Each decode runs on one thread, as more threads per image measured no faster.
Cache keys use the file's inode where the disk reports one, rather than its path, so renaming a
file or folder keeps its thumbnails. They leave out the device number, which the system assigns
afresh each time a volume mounts, so a network share that reconnects or a disk plugged in again
keeps its thumbnails too. Writes are atomic, and the cache is trimmed to a disk budget as it grows.

The window shows a cached thumbnail without asking for it first. `cachedThumbnailURL` names it by
its entry, as `media://thumbnail/<session>/<entry>?generation=…&size=…&modified=…&inode=…`.
Entries carry their file's inode beside its size and time, as the catalog listed them, and
those three name the thumbnail, so the main process finds the file itself (`listedKeyOf` in
`listed-thumbnail.ts`) and serves it or answers 404. No call reaches the folder's worker or its
catalog, where each tile's used to wait its turn behind whatever they were reading, and nothing
is asked of the disk the photo is on. Only an entry listed before the catalog kept inodes, or on
a disk that reports none, is left to the worker (`cachedThumbnail`), which looks in the catalog
and then at the photo itself; the main process remembers the key each such URL found
(`media-protocol.ts`). A file that changed where the watcher cannot see keeps showing its old
thumbnail until its folder is read again, as its listing does. Only an image that fails to load
asks `requestThumbnail` to make one, once its tile is on screen, so a tile never shows a
placeholder for a thumbnail that exists. The query changes the URL as the file changes, as the
cache key does, and a refresh raises the generation, so every thumbnail is read again.
An image shows only once it has loaded (`LoadedImage` in
`thumbnail.tsx`): until then the tile keeps its placeholder, such as a sidebar row's folder
icon, and an image that fails is never seen broken.

### HEIF photos

HEIC and HEIF photos are compressed with HEVC, which neither Sharp's build nor Chromium decodes,
so the system's codecs show them (`packages/media/src/heif.ts`): the viewer is given a full-size
JPEG, converted by `sips` on macOS and on Windows by the imaging component, which the
`@prism/windows-imaging` addon calls on a background thread. Their thumbnails are that same JPEG,
shrunk by Sharp like any other photo. Quick Look's and the Windows shell's stills are quicker but
scaled their own way, and Quick Look's sit about half a pixel lower than the picture, which shows
as a jump when the viewer swaps its thumbnail for the original. `sips` decodes faster than it
scales, and each conversion is a process of its own, so the thumbnail queue's conversions run side
by side. The worker keeps the most recent conversions in memory, up to 64 MB, rather than in the thumbnail
cache, where full-size photos would crowd thumbnails out of its budget. Windows decodes HEIF only with the HEIF Image
Extensions and HEVC Video Extensions from the Microsoft Store, and the viewer says so when they
are missing. Other platforms list HEIF photos without showing them.

### TIFF photos

Chromium does not decode TIFF either, though Sharp does, so TIFF thumbnails are made like any
other photo's. The viewer is given a full-size conversion from Sharp instead of the file, turned
upright since it keeps no orientation, and in Display P3 like thumbnails: a JPEG, or a PNG if
the photo is transparent, as an alpha channel that hides nothing is common in TIFFs. `isOpaque`
reads only the alpha channel to tell, as Sharp's `stats()` is ten times slower on a large photo. HEIF and TIFF originals share one path
(`packages/media/src/conversions.ts`, and `needsConversion` in `@prism/shared`): the worker
converts each once and keeps it in the same in-memory cache, and the `media:` protocol serves it
with its media type.

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
(`packages/catalog/src/photo-index.ts`). It lives
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
(`packages/catalog/src/cached-details.ts`). The `exif` table keeps what was read from each file by its absolute
path, across libraries, so a folder opened again as part of another library finds its photos'
details. A row counts only while its file has the size and modification time it was read at, and a
file renamed or moved is found by its device and inode, its row moving with it. Details read from a
file go into the catalog and the cache in one transaction, and rows nothing used for half a year are
dropped as the catalog opens. **File › Reset Photo Details** forgets every photo's details, in the
cache and the catalog, for edits that keep a file's modification time. It rewrites a row for every
photo, so it runs on a thread of the main process (`forget-details-thread.ts`) rather than holding
up the windows, which refresh once it is done.

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

Its code, in `packages/catalog/src/`, is in two layers. `data/` is the data layer: each
function there is one query, typed through Drizzle, taking the connection and the library it asks
about, and nothing else. The services beside it combine those queries: `writes.ts` applies what the
indexer and enricher send, `cached-details.ts` finds and keeps photos' details in the EXIF cache,
`summaries.ts` answers folder inspections, `views.ts` keeps the open views (narrowing each order
with `narrowing.ts`, and counting what to filter by with `facets.ts`), `details-queue.ts` picks the
photos to read next, and `pruning.ts` drops libraries past the budget. `host.ts` puts them together
on the catalog's thread, and `client.ts` is how the worker's own thread calls it. The thread runs
the main process's `catalog-thread.ts`, a build entry of its own, whose path the worker hands to
`Catalog.threaded`.

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
- **A folder's own entries are read through `items_parent`.** The queries behind a folder's
  listing, its summary and its covers (`data/contents.ts`) name that index too. Left to choose,
  SQLite read the whole library through `items_name` or `items_kind` to spare itself a sort of
  one folder's rows: a fifth of a second a query in a library of half a million entries, and
  seconds for the covers of a folder of folders. The catalog answers on one thread, in order, so
  every other read waited behind them, the rows of the view on screen among them.
- **Searches and filters narrow a cached order.** Each scope's order is read once per catalog
  change and shared by its views, which narrow it to the kinds they show and to the entries each
  search and filter lets through, a set read from an index of its own (`items_camera`,
  `item_tags` and so on), rather than one query per combination, which SQLite plans badly.
- **Unsupported files are kept, and counted.** A file of a format the app cannot show is still
  an entry, of kind `file`, which no view shows. Each version counts those of its scope from the
  same order, whatever its search and filters, and the status bar shows how many there are, so a
  file the app cannot show is never there unnoticed. System files such as `.DS_Store`, links and
  repeated names are left out of the read, so they are not counted.
- **Views are made again as the catalog changes**, at most every half second, or twice as long
  as making one took, so a large one never keeps the thread busy.

The indexer (`indexer.ts`) keeps the catalog true to the disk for what views show. It reads
each folder once a session, breadth first and up to 16 at a time, and writes only what differs
from what the catalog holds, so reopening a library is a walk of `readdir` and `stat` calls that
writes almost nothing, while its views already show it. Views of the same folder share one walk.
A view waits up to 400 ms for its own folder, so a folder read for the first time opens with its
entries rather than empty. Changes the watcher sees are written to the catalog in place, and a
folder that comes, as one moved in does, is read in full. A folder whose rows the catalog could
not write is read again when next asked for, rather than counted as read. The watcher's events
are compared with what the catalog holds of each path, which leaves out writes that changed
nothing; the worker remembers only which files' contents the window was shown, and as what, so
a rewrite of one of those also reads its contents again (`worker/changes.ts`).
As the index opens, libraries other than the one opening are dropped, those used longest ago
first, past five million entries in all; the one opening is never pruned.

## Ratings

An entry is rated from one to five stars, kept where it travels with the entry if it can be
(`ratesInFile` in `@prism/shared`). Photos keep theirs in their files, as XMP's `xmp:Rating`,
written by [ExifTool](https://exiftool.org) through `exiftool-vendored` (`packages/media/src/ratings.ts`).
It rewrites the file in place, keeping its inode, Finder tags and creation date, and removes the
ratings Windows writes in EXIF, so no app finds an old one. ExifTool is a Perl script, with a
build of its own on Windows; both are unpacked from the app's archive, and the main bundle leaves
the package external so it finds them. A photo's rating is read with the rest of its details:
by exifr for JPEG, PNG and TIFF, and by ExifTool for the formats exifr reads no XMP from, such as
HEIC, AVIF and WebP. It goes into `items.rating`, cleared as the file changes like the details.

Folders have no file to keep a rating in, and videos are left out of the photos' details, so the
app keeps theirs itself, in `ratings.db` beside the index, by absolute path (`ratings-schema.ts`,
`data/ratings.ts`). Unlike the index it is the only copy of what it holds, so it is never started
afresh: a file that cannot be opened, or that a newer build migrated, leaves this session's
ratings in memory. The catalog's thread opens it beside the index, and `stored-ratings.ts` combines
the two: rows, listings and covers carry these ratings, and views filter and count by them. A
rename in Prism moves the ratings of what it renames, and everything inside a folder; a move in
another app leaves them behind.

Rating a photo (`worker/rating.ts`) writes its file, reads its details again and stores both, and
notes the rewrite as seen, so the watcher's report of it reads nothing again; its thumbnail is
copied to the new file's key, as its pixels are the same. Ratings of the same entry wait for the
one before. The window rates through the library's `clientAction` with a fetcher per entry, so a
card and the preview over it show the chosen stars at once, and `rateEntry` (`data/ratings.ts`) then patches
the entry into the pages, listings and covers on screen until the views' new versions arrive.

A rating filter's values are `RATING_FILTERS` in `@prism/shared`: `rating=min3` keeps three stars
or more, `rating=max2` two or fewer, leaving out what has no rating, and `rating=unrated` only
that; of several, an entry passes any (`passesRatingFilter`). `narrowing.ts` makes the set from
every entry's stars, from both places ratings are kept, so unrated is what neither rates. Unlike
the other filters it keeps folders. Its facets count what each value lets through, unrated
folders included, and the search field lists them under **At least** and **At most**, with
**Unrated** apart (`TokenGroup.section`).

## Moving to the Trash

What a search or filter finds inside a folder, at every depth, can be moved to the Trash at once.
What matches is what a view of everything inside the folder, folders included, shows with the
same search and filters, so matching follows the views' own narrowing (`narrowing.ts`) rather
than rules of its own: a rating or a search can match a folder, and camera, lens, tag and format
filters match none. The catalog turns that view into a plan (`viewTrashPlan`), from every entry
inside the folder and both places ratings are kept (`packages/catalog/src/trash-plan.ts`).

A plan is a list of decisions, a row each, grouped by folder. Each row says why it is there and
offers its decisions: keep or trash, a matching folder also **only the matches** (judge what is
inside it on its own), and a conflict also **rescue** (move it up out of the matching folder, so
that folder can still go). The window sends back a default per reason and the rows decided by
hand (`TrashChoices`), and the catalog plans again. The rules are a pure function of the tree
(`trash-planner.ts`, with `trash-decisions.ts` for what each row offers and defaults to):

- **A matching folder goes with everything inside it**, unrated or not, except its
  **conflicts**: entries inside that are rated but would not match on their own, such as a 4-star
  photo inside a 1-star folder. Each is a row of its own, kept by default. A folder kept as a
  conflict keeps everything inside it, and what inside it matches on its own is a row too, also
  kept by default.
- **A folder everything inside is leaving goes too**, from the deepest up, unless it is rated,
  which says to keep it. Kept, only the folder stays; its contents still go. Sidecars (`.xmp`,
  `.aae`) and AppleDouble files go, or move, with what they belong to (`attachments.ts`), and an
  AppleDouble file of nothing goes with its folder. Any other file, such as a RAW file, is a
  row that keeps its folder unless trashed.
- **A match kept keeps everything it stands for.**

A plan holds the entries to move out first, then the entries to trash, none inside another.

Running a plan is the worker's (`trashView`, `photos/worker/trash-run.ts`). It plans again for
the version the sheet showed, and refuses if the catalog has moved on since, so what runs is
what was reviewed. Rescues go first, renamed into their new folder with their kept ratings; one
that fails stops the run before anything goes, as the folder it was rescued from would take it
along. Then each target goes to the system's Trash through `@prism/trash`, which says where it
landed, and the worker tells the window how far it has got (`onTrashProgress`). Entries gone
since the plan are left out; any other failure stops the run where it is, and the result says
what was done. Kept ratings stay at the paths trashed, so they reconnect when the entries come
back. The worker keeps the last few runs, and `undoTrash` puts one back: the trashed entries
first, then the rescued ones into them, each beside whatever took its place meanwhile under a
restored name, as `photo (restored).jpg`. The views follow through the watcher, as for any
change on disk.

A network share has no Trash of its own, so a run of a folder on one goes to Prism's Trash
instead (`photos/worker/prism-trash.ts`): a hidden `.prism-trash` folder at the top of the share,
its mount point or UNC share, with a batch for each run named by when it began, such as
`2026-11-12T14-03-22Z`. Items move into it by renames on their own volume, so even thousands go
at once, each at its path from the top, and the batch's `manifest.json` records where each came
from, written after every item, so a run that stops partway still says what it moved. Undo
renames them back, and takes the batch away once nothing is left in it, and the Trash once it
holds no batch. `.prism-trash` is an ignored name, so no listing, view or count shows it, and the
watcher ignores anything inside it. The manifest also records what the run was of: its folder,
from the top, and the search and filters that narrowed it.

Where Prism can't keep its Trash either, as on a read-only share or one it can't write to the
top of, a run deletes for good. That is settled before anything offers the run: the worker's
`trashPlace` says where runs go (`system`, `prism` or `delete`, with the share's name and why
it can't keep a Trash), checking it can write in `.prism-trash` or make it, and the window asks
it before the toolbar names the button and before the sheet shows (`trashPlaceQuery`). Deleting
for good then says so on the toolbar's icon, with a warning, in the sheet's title and the line
under it, and on a red confirm button that waits for **I understand these can't be recovered**.
The run is sent with the destination the person saw, and the worker refuses it if that is no
longer where it would go, so it never deletes for good unasked, nor falls back to it partway.
It deletes without crossing onto another volume, and keeps no run to undo, rescues included.
Neither Prism's Trash nor deleting for good takes an entry on another volume than the folder,
such as a share mounted inside it: a run with one stops before anything moves.

What is in Prism's Trash shows in the window as **Prism's Trash**, below the folder tree once it
holds a batch (`components/folder-tree/prism-trash-row.tsx`), and opens a page of its own,
`/library/trash` (`components/trash/prism-trash-view.tsx`). The worker lists the batches from
their manifests (`prismTrash`, `photos/worker/trash-service.ts`), newest first, and counts what
each holds at every depth only when its row asks (`prismTrashContents`). **Put Back** renames a
batch's items back where the manifest says they came from, under Undo's restored names where a
place is taken (`putBackTrashBatch`); **Delete Permanently** and **Empty Trash** delete a batch,
or the whole Trash, for good, after a confirmation with a red button. The worker only touches
batches by their names inside the share's own Trash, and forgets the runs whose batches are
gone, so Undo can't reach for them. The watcher ignores the Trash, so the window reads it again
itself after every run, Undo and action on it (`prismTrashChanged`); these go through the
library's action like ratings (`sessionAction`), so nothing else reloads.

In the window, the toolbar offers **Move matches to Trash** while a search or filter narrows the
view, and `trash` in the URL opens the sheet, so Back closes it (`components/trash/`). The sheet
opens its own view of everything inside the folder (`trashSpecOf`), and its worker reads every
photo's details at full speed (`plansTrash`), since conflicts depend on the ratings of photos
that do not match; until they are read, it says so. The decisions are the sheet's state: each
change asks the worker for a new plan (`trashPlanQuery`), and the last one shows until it comes.
What the sheet shows of the rows, by tab, chips and text (`data/trash-filters.ts`), and which
rows are selected (`data/trash-selection.ts`), never changes what is decided, only what one click
or key (K, O, R, T) decides at once. The sheet's chips are the toolbar's (`filterGroup`), so plan
entries carry the camera, lens and tags they filter by.

The sheet shows the plan two ways. **Decide** is the rows. **Files** lists every entry that would
go, one by one at every depth, and what moves out instead (`viewTrashFiles`, `trash-files.ts`):
the plan's targets with everything inside the folders among them, sidecars named by their photo.
It is asked for only while it shows, as a large plan lists thousands. The info button replaces
both with an explanation of the rules, told with the plan's own counts and examples
(`trash-explainer.tsx`).

The sheet's confirm button (`trash-confirm.tsx`) waits for a plan of every rating, made of the
choices as they are, then submits it to the library's action, which runs it in the worker
through the session's runs (`data/trash-runs.ts`). The button shows how far the run has got,
from the worker's progress, which the runs hear only while one is under way. Once it has run,
the sheet closes, and a toast in the library's layout (`trash-toast.tsx`) says what it did, with
Undo, for twenty seconds, held while the pointer or focus rests on it; what Undo put back then
shows as a toast of its own, counted as the run was if everything came back. The runs keep the
last one undoable after its toast goes, so ⌘Z (`undo`, outside text fields, where the Edit menu
undoes typing) puts it back too, once. A run that could not start, as when the folder changed since, says why in the
sheet instead. Rating, running and undoing need only the session (`data/session-actions.ts`),
so none of them reloads a route.

A modal `<dialog>` sits in the top layer and leaves the page outside it inert, so a pop-up opened
in the body shows behind it. `Dialog` provides its element as `PopupLayer`, and pop-ups inside it,
such as `TokenSearchField`'s list, open there.
