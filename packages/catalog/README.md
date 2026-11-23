# @prism/catalog

The catalog: what Prism knows of each library, kept in SQLite so the window never waits for the
disk. How it fits into the app is in [docs/architecture.md](../../docs/architecture.md#catalog).

## Layers

`src/` holds four folders, one per layer, plus `index.ts` (the package's exports) and
`__tests__/` (shared test fixtures).

| Folder          | What it is for                                                                       |
| --------------- | ------------------------------------------------------------------------------------ |
| `database/`     | Opening the two database files, and bringing their tables up to date.                |
| `repositories/` | The SQL: one file per table, and `queries/` for pieces that belong to no one table.  |
| `services/`     | What the app does with the catalog, one folder per feature, built from repositories. |
| `threads/`      | The threads the catalog runs on, and how the photo worker calls them.                |

`database/` has a folder per database file, each with its `schema.ts`, its `migrations/` and its
`open.ts`, which says what the file is called and what happens to a damaged one:

| Database                          | It is               | If the file is damaged                           |
| --------------------------------- | ------------------- | ------------------------------------------------ |
| `photo-index/` (`photo-index.db`) | a cache of the disk | thrown away and built again                      |
| `ratings/` (`ratings.db`)         | the only copy       | kept, and ratings live in memory for the session |

## Rules

- **Only `database/` opens connections.** Everything else takes the connection it is given.
- **A repository function is one query.** It takes the connection and what it asks about, and
  nothing else. A query that reads a large table names its index (`INDEXED BY`), and a
  query-plan test checks that SQLite uses it.
- **Services combine repositories** and read as steps in the app's own words. They hold no SQL.
- **General mechanisms**, such as a queue or a cache, live in a module of their own, named for
  the mechanism, and services use them.
- **No layer suffix in file names.** The folder names the layer: `repositories/folders.ts`, not
  `folders-repository.ts`.

## Where new code goes

| New…                          | Goes in                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------- |
| table                         | `database/<database>/schema.ts`, then a migration, then `repositories/<table>.ts` |
| query                         | the repository file of the table it reads                                         |
| SQL piece used by many tables | `repositories/queries/`                                                           |
| feature                       | a folder in `services/`                                                           |
| migration                     | made by drizzle-kit, below; never edit one that has shipped                       |

To make a migration after changing a schema, run from this folder:

| Database    | Command                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------- |
| photo index | `pnpm turbo db:generate`                                                                           |
| ratings     | `pnpm turbo db:generate-ratings`                                                                   |
| check both  | `pnpm exec drizzle-kit check` and `pnpm exec drizzle-kit check --config drizzle-ratings.config.ts` |

A migration's folder name and SQL are recorded in users' catalogs, so they never change once
shipped. See [docs/development.md](../../docs/development.md#querying-the-photo-index) for more.
