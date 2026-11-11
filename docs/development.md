# Development

[← Back to the README](../README.md) · [Architecture](architecture.md) · [Releasing](releasing.md)

- [Getting started](#getting-started)
- [Commands](#commands)
- [Project layout](#project-layout)
- [TypeScript, ESM and imports](#typescript-esm-and-imports)
- [Classes and functions](#classes-and-functions)
- [Testing](#testing)
- [Debug logs](#debug-logs)

## Getting started

The root `package.json`'s `devEngines` pins the pnpm and Node.js versions. pnpm downloads them
when needed, and CI reads the same configuration through `pnpm/setup`.

```sh
pnpm install
pnpm turbo dev
```

In [T3 Code](https://t3.codes), `t3.json` does both: a new worktree runs `pnpm install` before
its agent starts, and the Dev script runs `pnpm turbo dev`.

The dev runner uses electron-vite's main and preload build presets and connects their watchers
to React Router's renderer dev server:

| What changed             | What happens                                                   |
| ------------------------ | -------------------------------------------------------------- |
| Renderer components      | React Fast Refresh keeps component state; CSS updates in place |
| Main process             | Rebuilds, stops the old Electron process, starts the new one   |
| Preload                  | Rebuilds and reloads the renderer                              |
| Imported shared packages | Watched by their consumers                                     |

Vite pre-bundles the renderer's dependencies into `processes/renderer/node_modules/.vite`. React
Router's `future.unstable_optimizeDeps` points Vite's scan at the client entry and every route
module, so it finds them before the first load. A dependency it misses is found mid-load instead,
and on a cold cache that fails with `504 (Outdated Optimize Dep)` and leaves the window on its
loading screen: add it to `optimizeDeps.include` in the renderer's `vite.config.ts`.

`vite-plugin-devtools-json` answers the request DevTools makes for
`/.well-known/appspecific/com.chrome.devtools.json` with the repo root, so DevTools can connect
the repo as a workspace folder and save edits to its sources.

A development build keeps its data, such as thumbnails, the photo index, keybindings and the last
folder opened, in `Prism Development` in the system's app data folder
(`~/Library/Application Support` on macOS), which every checkout shares. The installed app keeps
its own in `Prism`. The end-to-end tests give each launch a temporary profile, and fail if the
app uses any other.

On macOS, `dev` and `start` run the app from `out/development/Prism.app`, a copy of Electron.app
that `scripts/development-app.ts` renames, gives Prism's icon and the bundle ID
`com.subwai.prism.development`, so the Dock, the menu bar and Activity Monitor show Prism rather
than Electron. It is rebuilt when Electron or the icon changes. The main executable inside keeps
the name `Electron`, because Electron treats any other name as a packaged build. Other platforms,
and the end-to-end tests, run the stock Electron.

## Commands

Every task runs through Turbo, which orders it after the tasks it depends on. Use
`pnpm turbo <task>`, or `turbo <task>` with Turbo installed globally:

```sh
pnpm turbo dev           # Run the app with HMR
pnpm turbo check         # TypeScript checks, including generated route types
pnpm turbo lint          # Oxlint
pnpm turbo test          # Each package's tests, cached per package (e2e builds the app first)
pnpm turbo test:all      # Every test as Vitest projects, in one run
pnpm turbo format        # Oxfmt: write formatting
pnpm turbo format:check  # Oxfmt: check formatting
pnpm turbo knip          # Knip: unused files, exports and dependencies, set in knip.jsonc
pnpm turbo build         # Compile all processes and generate the renderer SPA
pnpm turbo start         # Build, then open the production build
pnpm turbo dist          # Build installers and update metadata under out/release/
pnpm changeset           # Record a patch, minor, or major app change
pnpm turbo db:generate   # Write the photo index's next migration from its schema
```

Installing also sets up a pre-commit hook with [Lefthook](https://lefthook.dev), configured in
`lefthook.yml`. It applies Oxlint's safe fixes and then Oxfmt to the staged files, and stops the
commit if Oxlint still finds an error. Changes you have not staged stay out of the commit.

In VS Code, the recommended Oxc extension (`oxc.oxc-vscode`) does the same on save: it formats
with Oxfmt and applies Oxlint's fixes, as set in `.vscode/settings.json`. The settings point it at
the repo's own Oxfmt and Oxlint, so it runs the pinned versions even when user settings name
others.

`turbo.jsonc` lists every task. Each package's `package.json` scripts are plain commands for that
package, and its own `turbo.jsonc` declares its outputs. Shared packages export source, so they
have no build of their own and are checked by `turbo check`. Builds follow package build
dependencies without running type checks.

The root manifest is explicitly included in `pnpm-workspace.yaml` so Changesets can version the
app, which also makes it a package to Turbo. Its scripts therefore never call Turbo themselves;
`turbo.jsonc` addresses them as root tasks, `//#<task>`.

All generated output lives in `out/`: each process's build, the development app in
`out/development`, and electron-builder's packages in `out/release`. Main and preload dependencies are bundled, with Electron and Node built-ins
external. Native addons need explicit externalization and packaging support.

### Querying the photo index

Queries go in `packages/catalog/src/data/`, a function each, which run one query
and return plain values; the services beside `data/` combine them (see
[Catalog](architecture.md#catalog)). Write a query with Drizzle's query builder where it can say
it, and with its `sql` template where it cannot, such as for `INDEXED BY` or
`json_group_array`, naming columns through the schema (`${items.id}`) so they stay checked.
Three things to know:

- Drizzle prepares a statement every time a query runs. A query run once for each entry, as
  the writes of a library being read are, is built with `preparedOnce` and `sql.placeholder`
  instead, so it is prepared once per connection.
- SQLite uses a partial index, such as `items_unread`, only for a condition it can tell
  matches the index's own, and a bound parameter hides that. Write those values as literals
  (`sql.raw`), as `isUnread` in `details.ts` does.
- The query builder's `from` takes a table, not `sql`, while the columns it selects come from
  that table. A query that names its index is written whole with `sql`.

### Changing the photo index

The photo index's tables are declared with [Drizzle](https://orm.drizzle.team) in
`packages/catalog/src/index-schema.ts`, and change through migrations in
`packages/catalog/src/migrations/`, one folder each, named by when it was made. To
change a table, edit the schema and run `pnpm turbo db:generate`, which compares it with the last
migration's snapshot and writes the next migration as plain SQL. Read it before committing it:

- Data worth keeping, such as photos' EXIF details, which can take hours to read again on a
  network share, should survive the migration. Adding a column or an index keeps it.
- What is cheap to read again can simply go. A migration that empties `items` has the
  catalog read every library again, as it does a library opened for the first time.
- What Drizzle cannot declare goes in a migration of your own, written by hand:
  `pnpm turbo db:generate -- --custom --name <what-it-does>` makes an empty one. Triggers
  are written this way, and so is `WITHOUT ROWID`, added by hand to the tables of the first
  migration.

The ratings file, `ratings.db`, has migrations of its own, declared in
`packages/catalog/src/ratings-schema.ts` and written into `packages/catalog/src/ratings-migrations/`
by `pnpm turbo db:generate-ratings`. What it holds exists nowhere else, so its migrations must
keep every rating.

Never change a migration that has shipped: the app applies each one once, by name, and every
copy of the index already has it. The migrations are bundled into the build
(`index-migrations.ts`) and applied together when the index opens. An index that a newer build
has migrated further is left alone, and that session keeps its index in memory, so going back to
an older build never undoes a newer one's work.

## Project layout

```text
processes/   # One workspace per Electron process: main, preload and renderer
packages/    # Shared workspaces, such as the design system and the IPC types
e2e/         # End-to-end tests against the built app
resources/   # App icons for packaging, rendered by scripts/icons.ts
scripts/     # Build tooling, such as the dev runner
out/         # Generated and ignored
```

Every process has its own `package.json`, dependencies, and `tsconfig.json`. Add reusable
packages under `packages/`, declare them with `workspace:*` in the consuming process, and import
by package name. Keep shared browser code free of Node and Electron imports.

### The Windows imaging addon

`packages/windows-imaging` is a Node addon written in Rust with
[napi-rs](https://napi.rs), which calls Windows' imaging component to convert HEIF photos. Its
`build` task runs Cargo on Windows only and does nothing elsewhere, so working on Prism on macOS
or Linux needs no Rust. On Windows, install Rust with [rustup](https://rustup.rs) and the MSVC
build tools before `pnpm turbo build` or `pnpm turbo dist`. The Checks workflow builds and tests
it on a Windows runner.

To type-check the Rust on another platform, add the Windows target with rustup and check against
it; the `windows` crate does not compile for macOS or Linux:

```sh
rustup target add x86_64-pc-windows-msvc
cargo check --manifest-path packages/windows-imaging/Cargo.toml --target x86_64-pc-windows-msvc
```

## TypeScript, ESM and imports

Adapted from
[example-monorepo](https://github.com/subwai/example-monorepo#how-packages-resolve):

- Every workspace declares `"type": "module"` and uses ESM source. Main builds to ESM; the
  sandboxed preload builds to a single CommonJS file.
- `typescript` is [tsrs](https://github.com/pingdotgg/ts-rust) (`@tsc-rs/typescript`), the
  Rust port of TypeScript 7, so `tsc` runs it. In VS Code, the TypeScript 7 extension
  (`TypeScriptTeam.native-preview`, recommended in `.vscode/extensions.json`) runs the same
  binary as its language server: `.vscode/settings.json` turns it on and points
  `js/ts.tsdk.path` at `node_modules/typescript`. If it can't find the binary there, it falls
  back to the TypeScript 7 it bundles.
- Shared configs live in `@prism/typescript-configs`. Main and preload use `NodeNext`; the
  renderer uses `Preserve`/`Bundler`. Each workspace checks independently; the root config
  checks build tooling.
- Package-local aliases use native `package.json` `imports`, with `#*` pointing to source. No
  TypeScript `paths` or Vite alias table is needed.
- Shared packages export source through `exports` and are bundled into consumers, so there is
  no `dist` prerequisite for development or checking.
- Third-party versions live in the pnpm workspace `catalog`, with dependencies declared by each
  consuming workspace.
- pnpm's global virtual store is on, locally and in CI, so `node_modules` links into the store
  shared by every checkout. A package there sees only the dependencies it declares, with
  nothing hoisted, so one that imports a package it doesn't declare, such as types it leaves
  out, gets it added in `packageExtensions`. On Windows, CI caches only the store's content,
  since pnpm is denied the links a cache restores there.

The renderer's generated route types use a package import too, mirroring the route's path:

```ts
// src/routes/_browser+/library+/grid.tsx
import type { Route } from '#types/routes/_browser+/library+/+types/grid';
```

`pnpm turbo check` generates them before checking the renderer. They live under `.react-router/`,
which Git ignores.

## Classes and functions

Prefer functions. Keep state as plain data that its owner passes to the functions that read it
and return or update it, or at module level when a process has exactly one. Make something a
class only when most of these hold:

- Several instances are alive at once.
- Its state has invariants callers must not be able to break, such as sets that change
  together.
- It owns a lifecycle: listeners, timers, a worker or handles it must close.

A worker's client, the catalog's client, a request queue, a view a window holds open and the
library a worker serves meet that; a lookup table, a counter or a single map of sessions do not.

Don't write a factory that closes over mutable state and returns an object of methods: that is
a class without the name. Either take the state out as data, or make it a class. "The state has
to stay in memory" is not a reason for a class on its own; module state and plain records are
in memory too.

## Testing

Run `pnpm turbo test` for every package's tests, or filter to one package:

```sh
pnpm turbo test -F @prism/main   # Main-process tests
pnpm turbo test -F @prism/e2e    # End-to-end tests
```

Each package's `test` script also runs on its own, but only Turbo builds the app before the
end-to-end tests, and installs the browser the component tests need.

Tests live in `__tests__` directories, in two suites that each package's `vitest.config.ts` sets
up with `defineTestConfig` from `@prism/vitest-config`:

- **Unit tests**, `*.test.ts`, run in Node.
- **Component tests**, `*.test.tsx`, render components in headless Chromium with
  [Vitest Browser Mode](https://vitest.dev/guide/browser/) and `vitest-browser-react`, for the
  layout, observers and scrolling a simulated DOM lacks. A package opts in with
  `defineTestConfig({ component: { plugins } })`, and its `test` task depends on
  `@prism/vitest-config#browsers`, which installs Playwright's Chromium once per machine. In the
  renderer, `renderInLibrary` from `src/components/__tests__/render.tsx` renders a component
  as the library route does, with a fake photo API and the keys working.

Run one suite across packages with Vitest's project filter, such as
`pnpm turbo test:all -- --project '*(component)*'`.

`pnpm turbo test:ui -F @prism/renderer` and `pnpm turbo test:all:ui` open the Vitest UI with its
trace view on, where each component test step shows a snapshot of the page, photos included, to
step through. Vitest only keeps those snapshots for the UI, so plain runs leave tracing off.

End-to-end tests live in the `e2e` package and launch the built app with Playwright's Electron
driver, using the fixtures and helpers in `e2e/support`. The app keeps its window hidden unless
a run passes `--mode headed` to watch, as in `pnpm turbo test -F @prism/e2e -- --mode headed`.
Going full screen shows even a hidden window, so the full-screen tests only run headed, as CI
runs them. A window opening or going full screen over another app's on the display takes its
hover and drags, so files that go full screen or hold a drag form their own Vitest project,
which runs one file at a time after the rest. List a new one in `ALONE` in
`e2e/vitest.config.ts`.

## Debug logs

Every process logs what it does through `debug(namespace)` from `@prism/shared`, built on
[obug](https://github.com/sxzz/obug), the fork of `debug` that Vite uses. The logs are silent,
and cost nothing, until `DEBUG` names them:

```sh
DEBUG='prism:*' pnpm turbo dev                       # everything
DEBUG='prism:worker:*,prism:renderer:views' pnpm turbo dev
DEBUG='prism:*,-prism:*:calls' pnpm turbo test -F e2e  # all but the calls
```

Each line names its process and part, and the main process forwards the window's lines to the
terminal with a `[window]` prefix, so one terminal shows a change as it passes through each
process. The window's lines also show in its DevTools console, at the Verbose level. The
end-to-end tests print the app's logs with the test's output.

| Namespace                | What it logs                                                            |
| ------------------------ | ----------------------------------------------------------------------- |
| `prism:main:calls`       | The main process's calls to the folder's worker, and their time         |
| `prism:worker:watcher`   | What the system reported about files, and each time watching starts     |
| `prism:worker:changes`   | What the watcher saw, the changes told windows, and batches that failed |
| `prism:worker:views`     | Each view version the worker tells windows of                           |
| `prism:catalog:calls`    | The worker's calls to the catalog thread, and their time                |
| `prism:catalog:events`   | Views the catalog made again as it changed                              |
| `prism:renderer:calls`   | The window's calls to the worker, and their time                        |
| `prism:renderer:changes` | Changes the window applied                                              |
| `prism:renderer:views`   | View versions the window took, and the pages and places it read         |
| `prism:renderer:queries` | Each query's fetches, results, invalidations and removals               |

To log something new, add a `debug('<process>:<part>')` at module level and call it with
printf-style arguments, `%o` for objects. Keep calls cheap to skip: arguments are built even
when the log is off, so guard costly ones with `log.enabled`.
