# Development

[← Back to the README](../README.md) · [Architecture](architecture.md) · [Releasing](releasing.md)

- [Getting started](#getting-started)
- [Commands](#commands)
- [Project layout](#project-layout)
- [TypeScript, ESM and imports](#typescript-esm-and-imports)
- [Testing](#testing)

## Getting started

The root `package.json`'s `devEngines` pins the pnpm and Node.js versions. pnpm downloads them
when needed, and CI reads the same configuration through `pnpm/setup`.

```sh
pnpm install
pnpm turbo dev
```

The dev runner uses electron-vite's main and preload build presets and connects their watchers
to React Router's renderer dev server:

| What changed             | What happens                                                   |
| ------------------------ | -------------------------------------------------------------- |
| Renderer components      | React Fast Refresh keeps component state; CSS updates in place |
| Main process             | Rebuilds, stops the old Electron process, starts the new one   |
| Preload                  | Rebuilds and reloads the renderer                              |
| Imported shared packages | Watched by their consumers                                     |

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
pnpm turbo build         # Compile all processes and generate the renderer SPA
pnpm turbo start         # Build, then open the production build
pnpm turbo dist          # Build installers and update metadata under out/release/
pnpm changeset           # Record a patch, minor, or major app change
```

Installing also sets up a pre-commit hook with [Lefthook](https://lefthook.dev), configured in
`lefthook.yml`. It applies Oxlint's safe fixes and then Oxfmt to the staged files, and stops the
commit if Oxlint still finds an error. Changes you have not staged stay out of the commit.

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

## TypeScript, ESM and imports

Adapted from
[example-monorepo](https://github.com/subwai/example-monorepo#how-packages-resolve):

- Every workspace declares `"type": "module"` and uses ESM source. Main builds to ESM; the
  sandboxed preload builds to a single CommonJS file.
- Shared configs live in `@prism/typescript-configs`. Main and preload use `NodeNext`; the
  renderer uses `Preserve`/`Bundler`. Each workspace checks independently; the root config
  checks build tooling.
- Package-local aliases use native `package.json` `imports`, with `#*` pointing to source. No
  TypeScript `paths` or Vite alias table is needed.
- Shared packages export source through `exports` and are bundled into consumers, so there is
  no `dist` prerequisite for development or checking.
- Third-party versions live in the pnpm workspace `catalog`, with dependencies declared by each
  consuming workspace.

The renderer's generated route types use a package import too, mirroring the route's path:

```ts
// src/routes/_browser+/library+/grid.tsx
import type { Route } from '#types/routes/_browser+/library+/+types/grid';
```

`pnpm turbo check` generates them before checking the renderer. They live under `.react-router/`,
which Git ignores.

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
