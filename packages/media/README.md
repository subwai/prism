# @prism/media

What Prism knows about photo and video files: which files the library shows, how to read their
details and ratings, how to turn a format Chromium can't show into one it can, and the cache of
thumbnails. It runs in the main process and the photo workers, never in the window, as it uses
Node, sharp and ExifTool. How it fits into the app is in
[docs/architecture.md](../../docs/architecture.md).

## Layout

| Where                       | What it is for                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/kinds.ts`              | Which files are photos or videos, which the library leaves out, and what media type each is served as.                        |
| `src/exif.ts`               | A photo's details, such as when it was taken, its camera and its keywords, read with exifr.                                   |
| `src/ratings.ts`            | A photo's rating, as kept in its file's XMP, read with exifr and written with ExifTool.                                       |
| `src/conversions.ts`        | Full-size copies of the photos Chromium can't show, such as TIFF and HEIF, for the viewer, with a small cache of recent ones. |
| `src/heif.ts`               | Decoding HEIF with the system's own decoder: `sips` on macOS, and `@prism/windows-imaging` on Windows.                        |
| `src/opacity.ts`            | Whether an image has see-through pixels.                                                                                      |
| `src/concurrency-limits.ts` | How many thumbnails, conversions and reads run at once, and the size of the thread pool they share.                           |
| `src/thumbnails/`           | The thumbnail cache: making a thumbnail, naming it by its key, and keeping the cache within its 5 GB on the local disk.       |
| `src/index.ts`              | The package's exports. Everything else imports from here.                                                                     |

`thumbnails/thumbnail-index/` is the cache's own small SQLite index (`file.ts` opens it,
`schema.ts` and `migrations/` define it, `queries.ts` reads and writes it), so pruning can find
the thumbnails used longest ago without reading the folder. After changing `schema.ts`, run
`pnpm turbo db:generate -F @prism/media` to make the next migration.

## Rules

- **It reads only the photo it is given.** It never walks the library or decides when to read a
  photo: the photo worker's scheduler does, in the order the window needs. Making a thumbnail and
  converting a photo take an `AbortSignal`, so work for a photo scrolled past can stop.
- **Know a format in one place.** What a file is, how it's read and how it's converted live here,
  so the worker and the main process ask, rather than checking extensions themselves.
- **Thumbnail keys never change by accident.** A thumbnail's key includes how it was made
  (`thumbnail-key.ts`), so changing its size or quality makes new keys and leaves the old
  thumbnails to be pruned.
- **One query per function** in `thumbnail-index/queries.ts`, as in the catalog's repositories;
  `cache.ts` and `cache-upkeep.ts` combine them. A query that sorts or searches the table names its
  index (`INDEXED BY`), and a query-plan test checks it.
