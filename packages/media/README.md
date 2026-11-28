# @prism/media

What Prism knows about photo and video files: which files the library shows, how to read their
details and ratings, how to turn a format Chromium can't show into one it can, and the cache of
thumbnails. It runs in the main process and the photo workers, never in the window, as it uses
Node, sharp and ExifTool. How it fits into the app is in
[docs/architecture.md](../../docs/architecture.md).

## Layout

| Where                             | What it holds                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                            | Loose files here each know one thing about media files, such as which kinds the library shows, how to read their details or ratings, or how to convert a format. |
| `src/thumbnails/`                 | The thumbnail cache: making a thumbnail, naming it by its key, and keeping the cache within its 5 GB on the local disk.                                          |
| `src/thumbnails/thumbnail-index/` | The cache's own small SQLite index, with its schema, migrations and queries, so pruning finds the thumbnails used longest ago without reading the folder.        |

Everything the rest of the app uses is exported from the package's entry, `src/index.ts`. After
changing the thumbnail index's schema, run `pnpm turbo db:generate -F @prism/media` to make the
next migration.

## Rules

- **It reads only the photo it is given.** It never walks the library or decides when to read a
  photo: the photo worker's scheduler does, in the order the window needs. Slow work, such as
  making a thumbnail or converting a photo, takes an `AbortSignal`, so work for a photo scrolled
  past can stop.
- **Know a format in one place.** What a file is, how it's read and how it's converted live here,
  so the worker and the main process ask, rather than checking extensions themselves.
- **Thumbnail keys never change by accident.** A thumbnail's key includes how it was made, so
  changing its size or quality makes new keys and leaves the old thumbnails to be pruned.
- **One query per function** in the thumbnail index, as in the catalog's repositories, and the
  cache combines them. A query that sorts or searches the table names its index
  (`INDEXED BY`), and a query-plan test checks it.
