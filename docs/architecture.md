# Architecture

[← Back to the README](../README.md) · [Development](development.md) · [Releasing](releasing.md)

- [Processes and security](#processes-and-security)
- [React Router](#react-router)
- [Renderer](#renderer)
- [Keyboard](#keyboard)
- [Styling](#styling)
- [Photo API](#photo-api)
- [Thumbnails](#thumbnails)
- [Disk work](#disk-work)
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
folder, or reopening the last one on launch, starts from that view. The main process finds a
folder's canonical path once, as it is picked, and goes by it after that, in `last-folder.json`
too, so a launch reopens the folder, and its worker its catalog, without looking at the disk,
even if the folder is gone or on a share that is offline; reads of it then say so. The folders the tree opened
or closed by hand are the folder's own, and their IDs the main process's to read, so it keeps
them the same way, in `opened-folders.json` (both through `photos/main/per-folder-file.ts`).
The library layout's loader reads them before its first frame, with every folder the catalog
knows (see [The sidebar's tree](#the-sidebars-tree)), so the tree shows whole at once. The main process keeps the window's size
and place, maximized or full screen, in `window-state.json` (`window-state.ts`), read before
the window is made so it opens there. Closing to restart into an update also keeps the page it
showed, its path and query, which the next launch loads instead of the start page.

### The sidebar's tree

The window holds every folder of the library the [catalog](#catalog) knows, its **skeleton**:
each folder's ID and name, under the folder holding it, siblings by name, and its
[tile](#folder-tiles), which says whether the catalog has read it to the end (`folderSkeleton`).
Folders that borrow covers share them with the folder they come from, so the skeleton holds each
set of covers once, each cover as what names its thumbnail. It reads it once a session, with the
opened folders, into one store (`data/folder-skeleton.ts`) that `useTreeRows` reads with
`useSyncExternalStore`, and computes the rows from it (`components/folder-tree/tree-rows.ts`).
The catalog keeps it ready-made ([Catalog](#catalog)), and the worker sends it as text, which
the window parses (`wholeSkeleton`): a skeleton of 43,000 folders is 20 MB, and copying it
between threads and processes as tens of thousands of arrays took longer than reading it.
Opening and closing a folder, and **Expand All**, which opens every folder known to hold folders,
ask nothing of another process, however many folders the library has or however slow its disk.

The window applies the skeleton in one task, before the tree's first frame, so it does as little
as it can there (`skeletonToText` in `@prism/shared`). The folders come grouped as the store keeps
them, so it only makes their entries, and their covers come apart from them, after a line
break, each set as a line of JSON that a tile points at. A tile parses its own line the first
time something reads its covers, as the few dozen tiles on show do: parsing all 150,000 covers
of a library of 43,000 folders, and making entries of them, was most of the 51 ms it took. The
tile is a class, `SkeletonSummary`, so its `covers` getter is one on its prototype; a getter of
each tile's own took as long again. Folders are found by ID among the subfolders of the folder
holding them, as IDs are paths (`folderAt`), with no index of every folder, which took 2 ms to
make again each time the tree changed. Applying that skeleton now takes 4 ms in Chromium,
where it took 51 ms; `folder-skeleton.bench.ts` times each step (see
[Development](development.md)).

The catalog keeps the folders of earlier sessions, so the skeleton shows them while the indexer
reads the disk. As it does, the indexer tells which folders it found with other subfolders than
the catalog had, and the catalog which folders a write added folders to or removed them from,
once their rows are committed, since the catalog's reader sees nothing before, a batch every
quarter of a second (`LibraryUpdate.folders`), and changes on
disk and renames say which folders' listings they changed, once the catalog has them; the window
then reads those folders' subfolders again from the catalog and replaces each list whole,
dropping what it knew inside a folder that went. The catalog tells apart of the folders whose
tiles a write changed, or that it marked read (`LibraryUpdate.tiles`), which the window reads
again by ID and puts in place of those it knew (`folderTiles`), so a library's first read, as
covers pass up, reads only the folders that changed, not every subfolder of the folders holding
them. A listing that shows a tile that changed is read again only when next used, as the
library's folder's is always in use. The tree is the window's one source of folders:
the library layout's and the gallery's loaders, and the previews, find the folders from the root
down to the open one in it (`trailIn`), so a launch shows the folder it showed last with no
listing read. A folder the catalog has not read yet still
opens: its row's tile has the worker read it while on show ([Folder tiles](#folder-tiles)), and
its subfolders appear once read. Until
something says such a folder holds folders, its row shows no arrow: the tile of a folder the
catalog has not read says it holds nothing, which says nothing of its folders. An open one
keeps its arrow, so it can be closed. The row's arrow and the arrow keys both ask `treeRows` for
this (`expandable`), so they agree.

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
`clientLoader`s open the view and read its first page, and the folders the tree shows.
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

What individual tiles show, such as thumbnails and listings, lives in the same
[TanStack Query](https://tanstack.com/query) client, which each open folder's `LibrarySession`
owns. Loaders are per navigation and fetchers keep no data once unmounted, so React Router has
no shared cache for thousands of tiles that come and go as the grid scrolls. Route loaders read
the same queries when a navigation should wait for them, and components read them with
`useSuspenseQuery`. A loader reads through `fetchLatest` (`data/queries.ts`) rather than
`fetchQuery`: a change or refresh that invalidates a query cancels the read under way for a new
one, and TanStack Query rejects whoever had joined the old read with `CancelledError`, which
would show the library's error page; `fetchLatest` waits for the new read instead. Thumbnails being made and the viewer's originals read theirs with
`useQuery` instead: React holds back a Suspense boundary's content for up to 300 ms after its
fallback shows, which kept thumbnails made in a few milliseconds off screen that long, and the
viewer's last photo after an arrow key held down. A folder's cover and whether it holds anything
come with its row, so its tile asks for nothing ([Folder tiles](#folder-tiles)). Nothing
the window holds is patched: changes on disk invalidate the listings they touch, and those of the
folders holding them, whose tiles may show them, which are read again from the catalog, and reach views as new versions; a refresh invalidates everything, and the worker reads
the open views' folders again. A view's pages, places and facets name the version they were read
at in their query keys, so a new version is new queries rather than invalidated ones, and each
page's last read shows as placeholder data until the new one arrives. Either way, what is on
screen stays until fresh data replaces it.

### Pending edits

Ratings and renames show the moment they are made, though writing a rating into a photo or
renaming a file on a network share can take seconds. The session's pending edits
(`data/pending-edits.ts`, `LibrarySession.edits`) hold each edit under way by its entry's ID,
and every place that shows an entry lays them over the row it has: the grid, filmstrip and
reader through `useViewEntries`, the status bar and viewer through the entries those give them,
and the folder tree's rows and the folder preview's stars through `useShownEntry` and
`useRating`. Components read them with `useSyncExternalStore`, so the same edit shows the same
everywhere, and nothing patches views' pages or listings by hand.

An edit's answer takes its place, a failure drops it, so the row shows what it had, and the
action returns the error for the place that made the edit to show. Each edit of an entry's
rating or name replaces the one before, and only the latest settles or drops it, so rating keys
pressed in a row end on the last whatever order their answers come in. A rating's answer shows
until what held the entry, views' pages, listings and folders' covers, is read again from the
catalog, which has the rating before the worker answers; then the edit goes, and the rows show
it themselves. A rename changes the entry's ID, as IDs are paths, so the window keeps the
renames done in this session, old IDs to new ones and new names: a row read before the rename
keeps its old ID, and its place in the view's order, and shows the new name, until the view's
next version lists it under its new ID wherever its new name sorts. The catalog moves what is
inside a renamed folder with it ([Catalog](#catalog)), so before the rename settles the tree reads
again, under their new IDs, the subfolders of every folder it knew there: a folder open inside one
renamed stays open, under the new name. The same renames lead views
and selections from an old ID to the new one (`follow`), until a change on disk says something
took the old ID again. The rename dialog goes as soon as it is sent. A rename that fails stays
in the edits' `failures` until seen, and the entry menu shows a dialog for each, with what was
typed and why, even if another rename was started meanwhile (`components/entry-menu.tsx`).

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
which thumbnails are made, so overscan does not generate offscreen images, and tells the worker what is
on show, which drops what it was making of entries that left the viewport before their turn
([Disk work](#disk-work)); originals, which the reader requests for every page it renders, decode in
the window a few at a time, and those waiting for an entry that left wait until it is shown again. The reader's pages have no known size until they
load, so the virtualizer measures each one as it renders and estimates the rest. When the filmstrip's thumbnails change size, `use-grid-layout.ts` moves its scroll offset so the card in the middle stays there, or the strip stays at whichever end it was scrolled to, since a fixed offset would land somewhere else in the list at the new size.

Chromium stops an element growing at 16,777,216 px, short of a whole-library filmstrip or a grid
of a big enough folder, and TanStack Virtual has no answer for it yet (TanStack/virtual#616). So
the grid's and filmstrip's scroller is capped at 15,000,000 px, and `capped-scroll.ts` maps an
offset into it onto the whole list in proportion, with both ends exact, as react-virtualized
does. The virtualizer keeps to offsets into the whole list: `use-grid-layout.ts` gives it an
`observeElementOffset` and `scrollToFn` that map to and from the scroller's, places each row
less how far the scroller is short of the whole list, and scrolls to a row itself, since
`scrollToIndex` stops at the scroller's end. A list that fits keeps its offsets as they are; one
over the cap moves by more than a pixel for each pixel the scrollbar is dragged, and keeps its
place in the whole list as it grows or shrinks. A wheel or trackpad scrolls a list over the cap
by its own pixels instead: `use-grid-layout.ts` takes the wheel event, moves the virtualizer's
offset by the event's distance along the list (the grid down, the filmstrip across), scrolls
the scroller to where that falls in it, and tells the virtualizer the offset at once. A move
smaller than one of the scroller's pixels scrolls nothing, so the virtualizer keeps that offset
for as long as the scroller stays on the pixel the wheel left it at. The browser still scrolls a
list that fits.

A gallery's loader waits up to 100 ms for its
view's first page and the cached thumbnails it opens with; the rest appear as the worker makes
them. A view ready by then, such as a folder read
before, commits with them, so the router's crossfade goes straight to its photos. One that is not
commits anyway with a promise, which `AwaitGallery` shows as the toolbar and a spinner until it
resolves, and then fades in its contents. The spinner itself waits a moment, so a view that
arrives soon after shows none. The filmstrip's loader also waits for its first photo, as the
reader's does for its first pages, unless it is HEIF or TIFF: converting one takes longer than a view
should wait, so the viewer shows its thumbnail, scaled up, until the photo is ready. A re-sort or refresh of the same folder keeps showing it until the
next is ready instead, as the view defers what it shows. The router aborts only loaders that have
not returned, so the next gallery loader stops the one still reading after it committed.

### Folder tiles

A folder's tile, in the grid, the filmstrip or the tree, shows what its row says: whether it
holds anything, whether any of it is a folder, and up to four photos and videos as its cover,
the next whenever one has no thumbnail. The catalog keeps them on the folder's row
([Catalog](#catalog)), so a row carries everything its tile needs and a tile never makes a
second call. A folder whose row may not say all of it, as one the catalog has not read, or one
with no photos of its own but folders inside, has the worker read it in the background while it
is on show: the window tells the worker which tiles it shows as part of what it has on show
([Disk work](#disk-work)), and nothing is answered. The worker reads the folder, once a session,
while it is on show, and for one with no
photos of its own the folders inside, in the order the catalog chooses a lender, until one has
covers, opening at most 256 (`worker/tile-reads.ts`). Its row then changes as any row does: the
views showing it get a new version, and the tree hears of the folder holding it.

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
The worker brings the catalog's tables up to date before it says it is ready, and says first when
it has migrations to apply: main gives a worker 15 seconds to start, except one upgrading, which
it waits for, and tells the window on `photos:upgrading` (see
[Changing the photo index](development.md#changing-the-photo-index)).
Main handles the folder picker, menus, stills of videos from the system's thumbnailer, and the `media:` URLs that serve thumbnails and originals.

The code lives in `processes/main/src/photos/`, a folder for each place it runs: `main/` in the
main process (the IPC handlers, the `media:` protocol, the folder sessions and the client that
starts each worker), `worker/` in the folder's utility process (the library, its views, the
indexer, enricher and watcher), and `errors.ts` and `validate.ts` are shared by both. Two packages
hold the rest: `@prism/catalog`, in `packages/catalog`, is the [catalog](#catalog), which runs on
threads of its own, and `@prism/media`, in `packages/media`, reads photos and videos (file types,
thumbnails, conversions of the photos Chromium cannot show, and EXIF). Tests sit in a `__tests__/` folder beside the code they cover.

A few rules hold across the API:

- **IDs are opaque** and valid only for the folder session that issued them.
- **The window reads only the catalog.** `listFolder` answers a folder's own entries, folders
  first and then by name, from the [catalog](#catalog) at once, and whether the catalog has
  `read` the folder to the end; the worker reads the folder meanwhile, as on show, and the
  window reads the listing again once it tells of the folder (`LibraryUpdate.folders`).
  `folderSkeleton` answers the sidebar's tree every folder the catalog knows, or those inside
  some folders, at once. Changes on disk and renames are told once the catalog has them, so
  what the window reads again for them shows them. Nothing the window waits for asks the disk, so a library on a share
  that is slow or offline opens as fast as a local one. A folder whose last read this session
  failed lists nothing and says why, rather than what the catalog last saw of it, and whether
  it is `missing`: nothing is there any more. While the opened folder itself is missing, the
  library layout shows that in place of the tree and the gallery, until the watcher's checks
  find it back and read it again.
- **Galleries are views.** `openView` gives the window a view of a folder, or of everything
  inside it, sorted, searched and filtered in the worker; `viewRows` reads up to 1024 of its
  rows at a version, `viewIndexOf` finds an entry, `viewFacets` counts what to filter by, `viewErrors`
  lists what could not be read, which a view's state only counts, and `onUpdate` tells of each
  new version. The worker keeps the current version and the one before,
  so rows asked for as it changes still answer, and closes the oldest of a folder's views past 16. Views are queries of the catalog, so they show what is known at once, and
  grow as their folders are read. Rows and places asked for at a version the worker has let go
  come back as `null`, not as an empty page or -1, and the window asks again at the newest. An
  entry's place is asked once at each version.
- **Folders' tiles are on their rows.** The catalog keeps them as it is written, so nothing works
  them out as they are read; a folder on show whose row may not say all of it has the worker
  read it in the background (`worker/tile-reads.ts`), opening at most 256 folders to find
  covers. Nothing decodes pixels.
- **The window says what it shows, not what to read.** `attend` tells the worker, a moment after
  it changes, which entries, folders' tiles and rows of each gallery are on show, whole each
  time, and the worker's scheduler orders every read of the disk by it ([Disk work](#disk-work)).
  The window keeps no queue of its own for the worker's work.
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
starts each worker with `UV_THREADPOOL_SIZE` set to its thumbnails' reads and decodes, the
indexer's file calls and a few spare threads (`packages/media/src/threads.ts`). With libuv's
default of 4, finding a cached thumbnail waited behind the decodes. The indexer makes no more file calls at once than it has
threads (`read-folder.ts`): libuv's queue is first in, first out, so the thousand `stat` calls
it used to queue while reading a network share kept each cached thumbnail's waiting for
seconds. Each decode runs on one thread, as more threads per image measured no faster.
A photo is read whole into memory before Sharp decodes it, rather than handed to Sharp by its
path: libvips reads a file a few kilobytes at a time, each a round trip to a network share, and a
JPEG's thumbnail from a share was made 3–7 times faster read whole, and no slower from a local
disk. The read and the decode take turns of their own in the scheduler ([Disk work](#disk-work)),
as a read from a share mostly waits on the network, 70–300 ms a photo, while its decode takes
10–60 ms of a core: more photos are read at once than decoded, so 16 tiles of a share are made
in about a third of the time one turn for both took, measured with simulated latency in
`thumbnail-turns.test.ts`. A video's still, and the system's conversion of a HEIF photo, are
made in the decode's turn, as both are work for the CPU.
Cache keys use the file's inode where the disk reports one, rather than its path, so renaming a
file or folder keeps its thumbnails. They leave out the device number, which the system assigns
afresh each time a volume mounts, so a network share that reconnects or a disk plugged in again
keeps its thumbnails too. Writes are atomic, and the cache is trimmed to a disk budget as it grows.

The cache is one folder, `photo-thumbnails-v4` in the app's user data, shared by every library,
and holds up to 5 GB, about 380,000 thumbnails (`packages/media/src/thumbnail-cache.ts`). Each is
kept in the subfolder of the first two hex digits of its key, so no folder holds more than a few
thousand files. Which to remove when the cache is full comes from its index,
`photo-thumbnails-v4.db` beside the folder: each thumbnail's size and when it was last used, in
SQLite through Drizzle, like the [photo index](#photo-index). Pruning reads the index rather than
the folder, which at 5 GB would mean listing and looking at every file, so the workers prune after
every 50 MB they write. The index is one file for the one folder rather than a table in each
library's catalog, as libraries share thumbnails, and it lives beside the folder rather than in
it, so resetting the cache deletes the folder while every process keeps its connection to the
index, and empties the index in the same step. The workers note each thumbnail they make in it
at once, so one is counted even if the session ends next. Uses are noted in memory and written
together a couple of seconds later, so nothing a tile asks for waits on the index: a thumbnail the
worker finds counts as used, and so does every one the main process serves, which is what keeps
the order meaningful now that the `media:` protocol finds most thumbnails without the worker.

The main process looks after the folder in the background each launch (`thumbnail-upkeep.ts`):
it moves thumbnails that earlier versions kept in the folder itself into their subfolders, and,
if the index has not been made from the folder yet, as when it is new or its file was lost or
could not be read, makes it, a file at a time, taking each file's time as its last use, as
pruning did before the index. Until then, pruning leaves the cache alone, and finding a
thumbnail looks a second time where earlier versions kept it, moving it if it is there, so no
thumbnail is made again and none waits for the move. A file removed behind the index's back
counts toward the budget until it is pruned, and one the index lacks is added when it is next
found.

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
thumbnail until its folder is read again, as its listing does. The worker makes a thumbnail that is not
cached once its entry is on show ([Disk work](#disk-work)), and tells the window of each it makes,
or could not, or whose video's still the window must take itself (`storeThumbnail`), over the same
port as the library's updates (`ThumbnailNews`). The window keeps what it hears of the entries it
shows, and a tile whose cached thumbnail failed to load shows that, by its key. So a tile never
shows a placeholder for a thumbnail that exists, and never asks for one. The query changes the URL as the file changes, as the
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
scales, and each conversion is a process of its own, so the conversions HEIF thumbnails need run side
by side, as many as thumbnails are decoded at once. The worker keeps the most recent conversions in memory, up to 64 MB, rather than in the thumbnail
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
`photo-thumbnails-v<version>` and `photo-index-v<version>.db`, and the thumbnail index for its
folder's, as `photo-thumbnails-v<version>.db`. Raise the folder's version in
`thumbnail-directory.ts` whenever `thumbnailKey` or the pipeline changes, as the index's follows
its `SCHEMA_VERSION`. Builds of different versions, such as the installed app and a development
branch, then keep caches of their own instead of overwriting each other's. As the app starts, and
once a day while it runs, the main process removes the caches of other versions that nothing has
written to for a month, so an older build still in use keeps its own.

Sharp is external to the bundle, declared in both the main workspace and root application
manifests, and unpacked with its native binaries by electron-builder. The root runtime dependency
is needed for packaged dependency collection; pnpm installs both CPU variants for the macOS
release job.

## Disk work

Every read of the disk a folder's worker makes, of the share in particular, is ordered in one place,
its scheduler (`worker/scheduler.ts`), with the policy in plain functions (`worker/scheduling.ts`):
thumbnails, conversions, folders' listings and re-checks, tiles, and photos' details. Each job says
how much it is wanted each time the scheduler looks, so the order follows what the window shows as
it changes:

1. **On show**: thumbnails of the entries the window shows, conversions the viewer opens, folders it lists and
   the folder a view opens on, and the tiles of folders on show.
2. **Ahead**: thumbnails ahead of a gallery's scroll, and photos' details while a view needs them.
3. **Background**: the re-check of every folder of a view and of the library, and photos'
   details.

Each kind of work has limits of its own, as decodes wear on the CPU and listings on the disk or
share, and lower priorities fill fewer slots, so what the window shows never waits for one to free:
16 thumbnails' reads (`THUMBNAIL_READS`) of which eight ahead of the scroll, as many decodes as
`THUMBNAIL_CONCURRENCY` for thumbnails on show and one fewer ahead of the scroll, two
conversions, 16 folders' reads of which 12 for the re-check, four tiles, and 16 photos' details
while a view needs them or else four, or 12 while a Prism window is focused (`FOCUSED_LIMITS`),
which wait while thumbnails or conversions on show are under way. The main process tells each
worker as a Prism window gains or loses focus, over the port it starts the worker with, and the
scheduler looks again at once; reads under way when the limit drops finish, and fewer start. The lanes' slots are their own, so a re-check that fills the 12 of folders, as each
launch's check of the library does, leaves every read and decode to thumbnails on show. A
thumbnail's job holds its read's slot until its decode is done, so no more than 16 photos are held
in memory, and a photo read already is decoded even once the window no longer shows it, among the
work ahead of the scroll. Up to 256 thumbnails and tiles, and 64 conversions, wait their turn,
and a full lane turns more away until some is done; what the window stops showing is dropped long before. Jobs
share their key, as two asking for one thumbnail share its making, or two listing one folder its
read, and a shared job takes the priority of whoever wants it most.

The window tells the worker what it has on show (`attend`, from `data/attention.ts`), not what to
read: the entries whose thumbnails or originals are on show, as their tiles come into view, the
folders on show whose tiles may not say all they will, and the rows of its view each gallery shows,
from its virtualizer's range without the rows rendered past either edge. It sends it whole, 50 ms
after it first changes, so a scroll's frames are one message, and nothing is answered. Each photo
or video newly on show has its thumbnail made unless it is cached under the key its listing names,
which the window then loads itself; while it is still on show, it is made again after a refresh,
and once its contents change, right after telling the window they are stale (`report-changes.ts`),
so the new news never comes before the window forgets the old. Every thumbnail made, ahead of the
scroll too, is told of, so a tile that missed one being made just before still shows it. One not
yet started is dropped once the window says it no longer shows the entry, and made once it does
again; a tile likewise, though the folders a tile's read has opened go on in the background.

Thumbnails are made ahead of each gallery's scroll, after those on show, nearest to them first,
the row after before the row before (`worker/thumbnails-ahead.ts`). A folder's row stands for its
tile's first cover, as the catalog keeps it on the row, and a photo's or video's for its own. The
covers of the folders within 500 rows of those on show are made in every view. The photos and
videos are made only in a view of fewer than 1,000 rows (everything directly in the folder for the
grid, and everything inside it for the filmstrip), and then all of them. The worker reads the
rows from the catalog's reader, which names each thumbnail from the listing, so those cached
already cost a look in the local cache and no work. A small view is read whole, and again only
once it has a new version, not as the window scrolls; a larger one has only the rows within 500
of those on show read, each time the plan is made. The plan is made again each time what the window
shows or one of the views it shows changes, and what the last one handed the scheduler and did not
start is dropped. The window learns of these thumbnails as it does of any cached one, by loading it,
or, for a tile already on show, as the worker tells of it.

### Activity

The status bar's indicator spins while anything is under way, not only the view's own read, and
pointing at it lists the work, in words with counts. The worker counts it from what already
orders the work, with no query of its own (`worker/activity.ts`): the scheduler's jobs that run
and wait in each lane, the walk of folders under way that has found the most (`Indexer.walking`,
how many folders it has looked at of how many it has found), and what the catalog is busy with
besides answering calls (`Catalog.activity`): the entries queued or sent to the writer and not yet written, and
whether the reader's views' thread is making an order, or the writer the tree's skeleton, which
each tells as it starts and stops (`MakingNews`). Each of those tells as it changes; the worker
then sends the window an `Activity`, a quarter of a second later, and only if it differs from the
last, so nothing is sent while nothing changes, and tells it again to each window that connects.
The preload keeps the last one for the window's listeners, and the window reads it as an external
store (`data/activity.ts`) in the indicator alone (`ActivityStatus`), so the gallery does not
render again each time it changes. The words are the window's (`activityLines`).

Walks overlap: a view's walk reads folders the launch's check of every folder walks too, and each
counts them. So the walks' counts are not added, which would count a folder once per walk and
could show twice the library; the largest walk, the library's check while one runs, holds the
others' folders.

Each launch on a share is mostly a walk of every folder and photos' details read in the
background: on a library of 43,000 folders and 1.9 million files, the worker used half to most of
a core for minutes after the window had loaded, a full read of every folder when one was due, and
the status bar used to say nothing of it.

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
write. Its tables change through migrations, written by drizzle-kit and applied under the write
lock as it opens, so two workers never apply one twice; see [Changing the photo index](development.md#changing-the-photo-index). An index a
newer build migrated further is left for that build, and the session keeps its index in memory,
so the installed app and development builds of other branches, which share the user data folder,
never undo each other's changes. Files of the versions before migrations, such as
`photo-index-v5.db`, are removed once nothing has written to them for a month.

Photos' EXIF details are read in the background, every photo once, so filters and the sort by date
taken cover the whole library: those on screen first, then the rest of the view used last, in its
order, then the rest of the library. The enricher (`enricher.ts`) reads through the
[scheduler](#disk-work) in the background, 12 at a time while Prism is the focused app and four
otherwise, and makes way while thumbnails or
conversions the window wants are being made; while a view needs the details, as a sort by date
taken, a filter by camera, lens or tag, or the search field in use does, it reads 16 at a time
ahead of the background and waits for no thumbnails. What it reads goes into the catalog, so a later session carries on where it
stopped, and only photos that are new, or whose size or modification time changed, are read again.
The status bar of a view that needs them says how many are still to read. A photo a change on disk
or a rename lists afresh has its details recalled or read again in the background, so for a moment a
sort by date taken may show it out of place.

A photo's details live only on its row in `items`, as JSON with the camera, lens, date taken and
rating in columns of their own too, which the filters and the sort by date taken read through
their indexes. Before reading a photo, the enricher asks the catalog's writer for details it kept
before (`packages/catalog/src/recalled-details.ts`), which count only while the file has the size
and modification time they were read at:

- **Of a row removed.** A photo's row that goes leaves its details in `removed_details`, by its
  file's inode, size and modification time, through a trigger on `items`. A file moved or renamed
  where the app did not see it, or put back from the Trash, is listed afresh, and its new row takes
  them back. The inode leaves out the device, which the system assigns afresh each time a volume
  mounts, as thumbnails' keys do. A file on a disk that reports no inode leaves none. Rows that
  nothing took back for half a year are dropped as the catalog opens. A library that pruning drops
  leaves none either: its own row goes first, and the trigger skips the rows of a library that is
  gone, so a library of a million photos does not fill the table.
- **Of another library.** A photo inside the folder of another library, as when a folder is opened
  as a library of its own, takes the details that library's row has, found by its path there
  through `folders_path` and `items_entry`.

Renames the app makes move rows in place (`moves.ts`), so their photos keep their details without
either. Until November 2026, every photo's details were kept a second time, by absolute path, in
an `exif` cache, which took two fifths of the catalog's file. **File › Reset Photo Details**
forgets every photo's details, those of removed rows too, for edits that keep a file's
modification time. It rewrites a row for every photo, so it runs on a thread of the main process
(`forget-details-thread.ts`) rather than holding up the windows, which refresh once it is done.

Details are read through [exifr](https://github.com/MikeKovarik/exifr) with a fixed set of tags, so
it reads only the start of each file, and closes the file itself, as exifr leaves it open when a
file fails to parse. A photo's tags merge the keywords Windows writes in EXIF (`XPKeywords`),
editors such as Lightroom in XMP (`dc:subject`) and older tools in IPTC, once each whatever their
case; exifr cannot pick fields from XMP, so it reads that segment whole.

### Catalog

The catalog is every entry of every library the app has read, a row each in `items`, so a view
is a query rather than a list anything holds. Its tables are the index's own
(`index-schema.ts`), and it lives on three `worker_threads` threads of its own in each folder's
worker (`catalog-thread.ts`), each with its own connection, so a view of a large library never
holds up the thumbnails the worker's own thread answers:

- **The writer** applies what the indexer and enricher send, and edits such as ratings, and
  answers their own reads (a folder's listing, the folders inside a scope, the photos to read
  next) in the order they arrive, so each sees every write before it. Writes queue up and go in
  transactions of up to 4096 entries, every quarter of a second, and checkpoint the WAL less
  often, which writes a library several times as fast as a transaction a folder would.
- **The reader** answers everything the window reads, and keeps the open views. Its connection
  only reads, and the index is in WAL mode, so it reads the last write committed while another
  is under way: a page of a view, a folder's entries or the tree's folders never wait for a write, or
  for the indexer and enricher queued at the writer. During the first read of a library of 1.5
  million files, those reads waited behind the writes when one thread answered both.
- **The views' thread**, which the reader starts, makes the views' orders (`view-orders.ts`), and
  answers nothing else. Making a view of everything inside a library of 1.5 million files is one
  query, which SQLite runs to the end once started, sorting the whole scope for most sorts, and
  during a library's first read it is made again every few seconds; on the reader's thread, every page, tile and
  tree row the window asked for meanwhile waited for it. The reader keeps the views' versions,
  so their pages are read there at once, and has the views' thread make one order at a time
  (`view-queue.ts`): each view waits once however many writes come in while it waits, the one
  used most recently goes first, so a view just opened is made next, and a view made again as
  the catalog changes waits at least half a second, or twice as long as it took, after the last.
  Each order is asked for at the reader's count of the writes it has heard of, and is in memory
  every thread shares, so handing it over copies nothing. Closing a view drops what was to be
  made of it; closing the catalog lets the views' thread finish the query under way and close.

The writer tells of each write that changed a row as it commits, before answering it, and the
worker passes that on to the reader, which has its views made again from it. A write that
changed none tells nothing, so views keep their versions: SQLite counts the rows a write
changes (`total_changes()`), and an entry listed just as the catalog has it updates no row. So
the re-check each launch, which mostly finds nothing new, makes no view again. A read sees
every write whose caller has heard back, such as a rating, and a read of what was only queued waits for
`Catalog.committed` first: the indexer settles a folder's read for the window once its rows are
in, and a batch of changes is told with the versions that hold it once it is in. The reader in
turn tells the writer of the views' orders as they change, which the details queue reads photos
in; the orders are in memory both threads share, so that copies nothing. An index or ratings
file kept in memory, which only the connection that made it reaches, has one connection that
the reader, writer and views' orders share, on one thread.

Its code, in `packages/catalog/src/`, is in two layers. `data/` is the data layer: each
function there is one query, typed through Drizzle, taking the connection and the library it asks
about, and nothing else. The services beside it combine those queries: `writes.ts` applies what the
indexer and enricher send, `moves.ts` moves an entry the app renamed in place,
`recalled-details.ts` finds the details the catalog kept before of a photo listed afresh,
`folder-summaries.ts` keeps folders' tiles and reads them, `views.ts` keeps the open views' versions
(counting what to filter by with `facets.ts`), `view-orders.ts` makes their orders (narrowing each with
`narrowing.ts`), `details-queue.ts` picks the
photos to read next, and `pruning.ts` drops libraries past the budget. `writer.ts` and
`reader.ts` put them together on each thread, `host.ts` starts each (the reader starts the
views' thread), or all on one thread, and `client.ts`
is how the worker's own thread calls them, sending each call to the one that answers it. The
threads run the main process's `catalog-thread.ts`, a build entry of its own, whose path the
worker hands to `Catalog.threaded`.

- **Views are orders of entry numbers.** Each version is an `Int32Array` of `item`s, 6 MB for
  1.5 million entries, and a page of rows is a lookup by number. Asking SQLite for rows deep
  into a sorted query with `OFFSET` takes a second at that size; a lookup takes milliseconds.
- **Paths are kept once, a folder's each.** `items` keeps an entry by its folder's number and
  its name (`items_entry`), and `folders` keeps each folder's path, which is its ID, and its key
  for the sort by name: every folder with a row, the library's own folder, `.`, and any other an
  entry is in whose row is not in yet. An entry's ID is its folder's path and its name joined
  (`entryId`), which the data layer works out as it reads, so everything outside it keeps IDs
  that are paths. Triggers on `items` keep `folders` as rows come, go and change kind
  (the folder-triggers migration): a folder's path is its parent's and its name, joined by the
  library's separator, and a folder whose row goes keeps its number until the last entry in it
  goes too. Kept in every row's columns and indexes instead, paths took two fifths of a 1.8
  million-entry catalog; this way it is nearly a third smaller.
- **Sorts read straight from an index.** Each scope's order by name or date taken comes from an
  index, gathered with `json_group_array`, in about 100 ms for 1.5 million entries; the
  other sorts sort what they read. `grp` leads each index so folders come first, names sort by
  `name_key`, which folds case and accents and pads each run of digits so plain comparison sorts
  them as people read them, and ties go by entry number. The sort by name of a folder's tree
  goes folder by folder (`byName`): the folders by `key`, the keys of the folder's path joined by
  a character that sorts first, through `folders_key`, and each one's entries by name through
  `items_parent`, so a view of a folder's tree shows each folder's entries together, the folder's
  own before those of the folders inside it, rather than every folder's `1.jpg` side by side. The
  sort by date taken of a whole library reads `items_taken`. A descending view reverses each
  group of its ascending order. The queries name their index, as with one library every index
  looks alike to SQLite, and it picks one that leaves everything to sort.
- **A folder's own entries are read through `items_parent`.** The queries behind a folder's
  listing, its tile and its covers (`data/contents.ts`, `data/folder-summaries.ts`) name that
  index too, and a folder's tree is the entries of each of its folders, found by path in
  `folders`. Left to choose,
  SQLite read the whole library through `items_kind` to spare itself a sort of
  one folder's rows: a fifth of a second a query in a library of half a million entries, and
  seconds for the covers of a folder of folders. The reader answers in order, so every other
  read waited behind them, the rows of the view on screen among them.
- **The tree's folders are read folder by folder.** Folders alone make up the first group of
  `items_parent`, so every folder of a library comes from the folders by key and each one's
  folders by name, with nothing to sort
  (`everyFolder`), and the subfolders of one folder through `items_parent` (`foldersIn`).
- **Searches and filters narrow a cached order.** Each scope's order is read once per catalog
  change and shared by its views, which narrow it to the kinds they show and to the entries each
  search and filter lets through, a set read from an index of its own (`items_camera`,
  `item_tags` and so on), rather than one query per combination, which SQLite plans badly.
- **Unsupported files are kept, and counted.** A file of a format the app cannot show is still
  an entry, of kind `file`, which no view shows. Each version counts those of its scope from the
  same order, whatever its search and filters, and the status bar shows how many there are, so a
  file the app cannot show is never there unnoticed. System files such as `.DS_Store`, links and
  repeated names are left out of the read, so they are not counted.
- **A folder's tile is kept on its row**: `has_entries`, `has_subfolders` and `covers`, the
  numbers of up to four entries, photos first, as JSON. Numbers rather than copies, so a read
  looks the covers up by key, with their files and ratings as they are now. A folder with no
  photos or videos of its own borrows the covers of its first folder by name that has any, own
  or borrowed (`summaryNow` and `firstLenderCovers`, the one place that chooses). The writer
  works out the tiles a write changes in the same transaction: the folders an entry came to or
  left, a folder listed or marked read, deepest first, then passes covers up a folder at a time,
  stopping at the first whose covers stay as they were; a folder borrows only what its
  subfolders have stored, so a write never reads further down, and finds the first with any
  through `items_lenders`, which holds only folders with covers, by name, so it reads one row
  however many folders it holds. A cover whose file was replaced is the same entry, but its
  thumbnail changed, so it is passed up as a change too. The writer then tells which folders'
  tiles changed, or that it marked read, as the tree shows that with the tile, which the tree
  reads again, as views do with their new versions, and apart, which folders it added
  folders to or removed them from.
  The library's own folder has no row in `items`, as no folder holds it, so the library's row
  keeps its tile in the same three columns. The writer works it out last, after the folders
  inside it, by the same rule, and tells of the library's folder when its tile changed; every
  skeleton carries it, so the tree's root row is read from the disk no more than any other
  folder's. Rows a build before tiles wrote have `NULL` there and keep no tile: nothing fills
  them in, so such a catalog is deleted and read again rather than kept.
- **The tree's skeleton is kept ready-made**, as text in `folder_skeletons`, a row a library
  (`folder-skeleton.ts`). Made from the folders' rows, it reads every folder and every cover's
  file, rows spread through the whole of `items`, which took four seconds from a cold disk for a
  library of 39,000 folders, with the window's reads waiting behind it; the row reads in
  milliseconds. A write that changes what it shows deletes it in the same transaction, so a
  skeleton kept is always the catalog's: a folder that comes or goes, one read to the end, or a
  tile that changes, which a cover's file rewritten or removed does too, as its size, time and
  inode name its thumbnail. Photos' details and a library read again as the catalog has it
  leave it. The writer makes it again once such writes stop for five seconds, and as the
  catalog opens without one, so the reader only reads it. The window asks the reader for the one
  kept, and without one the writer, which makes it from the folders' rows: the reader answers
  the window's reads one at a time, and a launch's first listing of the library's folder waited
  behind making it, a third of a second for 44,000 folders even from a warm disk. Each is kept
  with the shape of its text (`SKELETON_FORMAT`), as builds that share the index may send it
  otherwise; one in another shape is made again.
- **Views are made again as the catalog changes**, at most every half second, or twice as long
  as making one took, so a large one is not made over and over while the library is read.

The indexer (`indexer.ts`) keeps the catalog true to the disk. It reads each folder once a
session, breadth first and up to 16 at a time through the [scheduler](#disk-work)
(`folder-walk.ts`): a scope's own folder first and alone, as on show, and if it can be read, the
rest as a re-check in the background; nothing inside a folder that cannot be read is tried, so
an offline share costs one failed read. It writes only what differs from what the catalog
holds, so reopening a library is a walk of `readdir` and `stat` calls that writes almost
nothing, while its views already show it. Views of the same folder share one walk, and every
walk shares its reads with the others. A folder the window or a tile read already read this
session is not read again: the walk takes its subfolders from the catalog. Each launch walks the whole library once too
(`checkEveryFolder`), so the catalog catches up with what changed while the app was closed,
folders gone included; views' reads come first, and it stops as the library closes. That walk
and every view's read their own folder in full, as it is on show, but of the folders inside it
only those that changed, while a refresh, a full read and a folder the watcher saw come read
every folder in full (`IndexOptions.full`). One `lstat` of each folder compares its
modification and change times and its inode with its **stamp**, what a read that got to the end
with nothing failing found as it began, kept in `indexed_folders` (`FolderStamp`). An entry that comes,
goes or is renamed moves its folder's times, and a tool that sets them back still moves the
change time, so a folder whose stamp is as kept holds what the catalog has of it, and the walk
takes its subfolders from the catalog. A folder the walk finds that the catalog did not know
(`foldersInside`) has no stamp, so it is read without one being looked for, as every folder is
on an empty catalog. A file rewritten in place moves neither time, so the catalog learns of it
only as its folder is read in full otherwise: by the window opening it, a refresh, the watcher,
or a **full read** (`libraryChecks`), which reads every folder of the library in full, those read
this session included. A launch's check is a full read instead when none ended in the last
week, and **File › Read Library Again** starts one at once, from the main process, unless one
this session began is under way. A full read notes when it began in
`libraries.full_read_started_ms` before it reads any folder, and one that gets to the end with
the library's own folder read notes when in `libraries.full_read_ms` and clears the start. One
the library closes during leaves its start, and the next launch's check takes it up again
(`fullReadDue`): every folder is still walked, but one read to the end with nothing failing
since it began, by the window, a check or the full read itself, is not read again, as
`indexed_folders.read_ms` notes when each folder's last such read began, beside its stamp; its
subfolders come from the catalog. Noting it changes no row a view shows, so it makes no view
again. A start over a week old is too stale to take up, so the read starts afresh. Read Library
Again always starts afresh and reads every folder, after one taken up again if it is under way,
as that leaves folders read before this launch. A folder never read, or whose last read failed or could not look at every entry, has no
stamp and is read in full. An entry its listing names but that `stat` finds nothing at
(`ENOENT`) is listed without details and its failure told, but leaves the read complete: over
SMB on macOS, names that end in a dot or a space list but cannot be looked at, and an entry
really gone since the listing moved the folder's times after the stamp was taken. A folder with
such a name cannot be looked at or read by its path at all, so it never has a stamp: when its own
`lstat` finds nothing there (`isUnchanged`), it is left unread if its parent's stamp holds, as the
parent then still lists it and a read could only fail again; its parent is looked at after it,
so one gone in between is read and found gone. On a share
of 43,000 folders and 1.9 million files, that makes a launch's walk of an unchanged library 43,000 `lstat` calls instead of a `realpath`, a `readdir` and a
`stat` of every entry. The folder's own row, which its parent's listing writes, is no stamp: it
can be written after the folder changed and before it is read. A view
opens on what the catalog has, never waiting for its folder, and gets a new version as rows
arrive: a folder read for the first time opens empty and fills in. The indexer remembers which
reads failed this session, which listings answer with, and tells the window of each folder
whose read failed, read it to the end for the first time, or found other subfolders. Changes the watcher sees are written to the catalog in place, and a
folder that comes, as one moved in does, is read in full. A folder whose rows the catalog could
not write is read again when next asked for, rather than counted as read.

A rename or move the app makes itself, in the window or as a move to the Trash rescues entries
or Undo puts them back, moves the catalog's rows with it once the disk's rename succeeds, rather
than removing them and reading the folder again from the disk, which for a folder of 237,000
photos on a share took minutes (`library-changes.ts`, `moveInCatalog`). The entry's row takes its
new name and folder; the `folders` rows of it and of every folder inside it, and what
`indexed_folders` keeps of them, take the new path and key in place, two statements each; and
the entries inside keep their numbers, so their details, tags, covers and views' orders need
nothing, and their thumbnails, named by inode, are found again. Kept ratings move by path, as
before. The tiles it left and came to are worked out again, the covers it lends passed up as
changed, as covers show their entries' IDs, and the tree reads again the subfolders of every
folder moved, so the skeleton goes as for any write that reshapes the tree. No trigger is
involved: those on `items` fire as rows come and go or change kind, not as they are renamed.
The indexer keeps what it read this session under the new IDs, so a view of the moved folder's
tree reads nothing, and reads the moved folder itself again, to confirm; the folders inside keep
their stamps, so the next launch's walk reads none of them. The watcher's reports wait for moves
under way, then find the catalog as the disk is, and say nothing of them. A move the catalog
cannot make so, as when it still has something at the new path that has gone from the disk, or
has nothing at the old one, is described as any change on disk is instead, and what came is read
in full. The watcher's events
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
ratings in memory. The catalog's reader and writer each open it beside the index, and `stored-ratings.ts` combines
the two: rows, listings and covers carry these ratings, and views filter and count by them. A
rename in Prism moves the ratings of what it renames, and everything inside a folder; a move in
another app leaves them behind.

Rating a photo (`worker/rating.ts`) writes its file, reads its details again and stores both, and
notes the rewrite as seen, so the watcher's report of it reads nothing again; its thumbnail is
copied to the new file's key, as its pixels are the same. Ratings of the same entry wait for the
one before. The window rates through the library's `clientAction` with a fetcher per entry, which
says why a rating did not take, and `rateEntry` (`data/ratings.ts`) shows the chosen stars at once
as a [pending edit](#pending-edits), then as answered until what showed the entry is read again.

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
