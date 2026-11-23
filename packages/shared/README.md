# @prism/shared

What every process of Prism shares: the main process, the photo workers and the window. How it
fits into the app is in [docs/architecture.md](../../docs/architecture.md).

## What it holds

| Where             | What it is for                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/*.ts`        | The types, constants and small helpers of one topic each: photos, views, trash, activity, the worker's messages and so on. |
| `src/mechanisms/` | General mechanisms, such as running tasks one after another; see below.                                                    |
| `src/index.ts`    | The package's main entry, `@prism/shared`.                                                                                 |

## Entry points

- **`@prism/shared`**, the main entry, uses nothing only Node or only a browser has, so the
  window may import it as freely as the main process and the workers do.
- **Node-only entry points** hold what needs Node. The window never imports them, so its bundle
  never pulls in Node's modules. Add one to `exports` in `package.json` for anything that does.
  - **`@prism/shared/sqlite`**: `openSqlite` opens a SQLite file with a busy timeout, sets it up,
    and closes it again if that fails; `WRITER_SETTINGS` puts a written file in WAL mode,
    SQLite's write-ahead log. The catalog and the thumbnail index open their files with it.

## General mechanisms

A mechanism, such as a queue or a cache with a limit, is written once and used by name, so the
code that uses it reads as the app's steps. Look here, and at the libraries below, before writing
one. Each one in `src/mechanisms/` has its tests in `src/mechanisms/__tests__/`.

| Mechanism               | What it is for                                                                                                                                                       | Used by                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `OneAfterAnother`       | Tasks that run one after another, each once the one before has settled.                                                                                              | change reports, moves in the library, files kept per folder                |
| `OneAfterAnotherPerKey` | The same, with one line of tasks for each key, such as each photo.                                                                                                   | ratings                                                                    |
| `JoinableRun`           | Work that a second caller joins while it runs, rather than starting it again. Some call it "single flight".                                                          | the share's online checks, the check of every folder                       |
| `JoinableQueue`         | Keys waiting for work, done one at a time in the order `pickNext` chooses. Asking for a key that already waits joins it, and everyone who asked gets the one result. | the catalog's views waiting to be sorted again                             |
| `DelayedCall`           | One call a moment after the first request, however many come meanwhile. Some call it a "throttle".                                                                   | activity, folder changes, the folder watcher, the window's screen contents |
| `runAFewAtATime`        | At most so many at once, from a list that may grow while they run.                                                                                                   | the folder walk, thumbnails ahead of the scroll                            |
| `Listeners`             | Functions to call with each new value.                                                                                                                               | events across the app                                                      |

Libraries and built-ins already do some of these jobs:

| Job                                                           | Use                                    |
| ------------------------------------------------------------- | -------------------------------------- |
| A map that keeps at most so many entries, dropping the oldest | `LRUCache` from `lru-cache`            |
| At most so many calls at once, every call known up front      | `p-limit`                              |
| Items grouped by a key, keeping their order                   | `Map.groupBy`                          |
| Every file and folder inside a local folder                   | `readdir(folder, { recursive: true })` |

Walks through local folders have no helper of their own: Node's recursive `readdir` lists a whole
tree, and the few hand-written ones each do something it can't, such as stopping at the first
file or never crossing onto another disk. The share's walk in the photo worker's `indexer/` is its
own, as it goes through the scheduler and pauses while the share is offline.

`lru-cache` moves an entry to the newest when `get` reads it; `peek` reads it without that.
Choose the one that matches what counts as using the entry.
