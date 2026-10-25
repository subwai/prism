# Prism

A local photo browser built with TypeScript, Electron, and React Router framework mode.

## Run

The root `devEngines` configuration pins pnpm 12.15.0 and selects Node.js `^24.22.1`. pnpm downloads the configured package manager and runtime when needed; CI reads the same configuration through `pnpm/setup`.

```sh
pnpm install
pnpm turbo dev
```

Choose a folder to browse it. The grid shows its immediate photos and folders; the filmstrip includes photos in subfolders. Shift+Space previews an image or peeks inside a folder, Enter opens it, and arrow keys move the gallery selection. In the viewer, Space plays or pauses a video and M mutes it. Left and Right browse until you play, pause, click, seek or scrub a video; from then on they seek five seconds, and Shift+Left/Right move to the previous or next item. Cmd/Ctrl+Shift+F shows the photo or video full screen.

Keyboard shortcuts work like VS Code's: two files combine into the keymap. The defaults ship with the app in `packages/keybindings/src/default-keybindings.jsonc` (File > Default Keyboard Shortcuts opens a read-only copy). Your own go in `keybindings.json` in the app's settings folder (File > Keyboard Shortcuts… creates and opens it; in development that is `~/Library/Application Support/electron-starter/` on macOS). Its rules, such as `{ "key": "n", "command": "next", "when": "viewerFocus" }`, come after the defaults; for any key the last rule that holds wins, and `"-next"` removes the defaults for a command. Changes apply when the file is saved. The renderer resolves every key against the keymap; the menu only shows the keys. A command, from a key or the menu, goes first to what has focus and what holds it, then to the fallbacks of the frontmost layer (the open sheet, or else the window), such as the viewer, so its keys work with focus elsewhere in its sheet. Components handle commands with `useCommands` on their own element, or `useGlobalCommands`; `data-keys` and `data-layer-keys` attributes give the keymap's `when` contexts.

## Photo UI

The renderer stays in SPA mode (`ssr: false`), with no runtime server. Thin route modules use `clientLoader` and `clientAction` through the preload bridge. `/library/grid` and `/library/filmstrip` are separate routes, which share a `GalleryFrame`; the `folder`, `q`, `sort`, `order`, `preview`, and `slideshow` query parameters carry the view's state, so Back closes a preview. Router updates apply at once rather than as transitions (`entry.client.tsx`), so the previewed photo follows every key press; views that should hold what they show until the next is ready defer it with `useDeferredValue`. Folder IDs stay opaque. A page reload returns to the folder picker because filesystem access belongs to the current session.

`renderer/src/` separates rendering (`components/`), data and IPC helpers (`data/`), and UI hooks (`hooks/`); `keyboard/` holds the keymap and commands the whole window shares. Each screen or feature gets a folder in `components/` (`gallery/`, `viewer/`, `design-system/` for the design-system route, and so on) holding its components and the hooks only they use; what features share sits at the top of `components/` and in `hooks/`. Components never load data in effects. Route `clientLoader`s open the gallery's scan and read the folders the tree opens; the scan then streams its remaining pages, which the gallery subscribes to with `useSyncExternalStore`.

What individual tiles show — thumbnails, folder covers and summaries, originals, folder listings and previews — lives in a [TanStack Query](https://tanstack.com/query) client that each open folder's `PhotoLibrary` owns. Loaders are per navigation and fetchers keep no data once unmounted, so React Router has no shared cache for thousands of tiles that come and go as the grid scrolls. Route loaders read the same queries (`fetchQuery`) when a navigation should wait for them, and components read them with `useSuspenseQuery`. Changes on disk patch listings in place and invalidate what changed; a refresh invalidates everything. Either way, what is on screen stays until fresh data replaces it. The sidebar observes the listings of the folders it has open, so those stay cached however many folders are read.

Sorting by name avoids per-file metadata reads; choosing date or size sorting requests metadata. Each sort order is computed once per listing and narrowed for searches; pages a scan streams in are sorted on their own and merged into the sorted list.

The tree, grid, and filmstrip are virtualized. Intersection visibility separately gates thumbnail requests, so overscan does not generate offscreen images; queued thumbnail and summary work for entries that left the viewport waits aside until they are shown again. A navigation waits up to 250 ms for the thumbnails it opens with, so cached ones paint on its first frame while uncached ones fill in afterwards. Folder covers only inspect immediate children.

## Layout

```text
processes/
  main/src/           # Electron lifecycle, windows, local app protocol
  renderer/src/       # React Router root, routes, and styles
  preload/src/        # Narrow contextBridge API exposed as window.app
packages/
  design-system/src/  # Shared UI components, Tailwind theme tokens, and brand assets
  electron-devtools-installer/src/ # Fetches React DevTools for the dev server
  keybindings/src/    # Keymap: default shortcuts, keybindings.json rules, key matching
  shared/src/         # IPC channel names, the preload API's types, and the worker protocol
  typescript-configs/ # Strict base, Node, and browser configs
e2e/                  # End-to-end tests against the built app
resources/            # App icons, rendered by scripts/icons.ts, for packaging and development
scripts/
  dev.ts              # Renderer dev server and Electron build watchers
  icons.ts            # Renders resources/ icons from the design system's brand layers
out/                  # Generated, ignored: main/, preload/, renderer/ builds and release/ installers
```

Every process has its own `package.json`, dependencies, and `tsconfig.json`. Add reusable packages under `packages/**`, declare them with `workspace:*` in the consuming process, and import by package name. Keep shared browser code free of Node/Electron imports.

## TypeScript, ESM, and imports

Adapted from [example-monorepo](https://github.com/subwai/example-monorepo#how-packages-resolve):

- Every workspace declares `"type": "module"` and uses ESM source. Main builds to ESM; the sandboxed preload builds to one `.cjs` file.
- Shared configs live in `@prism/typescript-configs`. Main and preload use `NodeNext`; the renderer uses `Preserve`/`Bundler`. Each workspace checks independently; the root config checks build tooling.
- Package-local aliases use native `package.json` `imports`, with `#*` pointing to source. For example: `#window`, `#constants`, and `#style.css`. No TypeScript `paths` or Vite alias table is needed.
- Shared packages export source through `exports` and are bundled into consumers. There is no `dist` prerequisite for development or checking.
- TypeScript enables the `development` condition. Current shared packages resolve to source in both development and production builds.
- Third-party versions live in the pnpm workspace `catalog`, with dependencies declared by each consuming workspace.

Renderer generated types also use package imports:

```ts
// src/root.tsx
import type { Route } from '#types/root';
// src/routes/about.tsx
import type { Route } from '#types/routes/+types/about';
// src/routes/_browser+/library+/grid.tsx
import type { Route } from '#types/routes/_browser+/library+/+types/grid';
```

`pnpm check` runs React Router type generation before checking the renderer. Generated files under `.react-router/` are ignored by Git. Source aliases resolve during bundling; Electron runs the resulting JavaScript.

## React Router

The renderer uses [framework mode in SPA mode](https://reactrouter.com/how-to/spa): the Vite plugin, `src/root.tsx`, route modules registered in `src/routes.ts`, generated route types, and `clientLoader`/`clientAction` support. `ssr: false` removes the runtime server. The small server entry renders the root shell at build time; keep initial renders free of browser-only APIs and access `window.app` in client loaders or event handlers.

`src/routes.ts` discovers routes with [remix-flat-routes](https://github.com/kiliman/remix-flat-routes) through React Router's adapter. Folders ending in `+` group route files: `_browser+/_layout.tsx` provides the pathless browser shell, and `_browser+/library+/_layout.tsx` wraps the grid and filmstrip. `_index.tsx` is the home page. Generated types mirror those folders and share the `#types/routes/*` package import.

React Router owns the renderer's Vite config and production build. The dev runner uses electron-vite's main/preload build presets and connects their watchers to the renderer server:

- Renderer components: React Fast Refresh preserves component state. CSS updates in place.
- Main: rebuilds, stops the old Electron process, then starts the new one.
- Preload: rebuilds and reloads the renderer.
- Imported shared packages: watched by their consumers.

The production renderer loads at `app://app/`. A local protocol handler serves assets and falls back to the SPA shell for page URLs, so browser-history routes and refreshes work. No HTTP server runs in production.

## Styling

Tailwind CSS uses the [Vite plugin](https://tailwindcss.com/docs/installation/framework-guides/react-router) in the renderer. Add utility classes directly in route components; CSS updates through Vite HMR. The theme's tokens live in `@prism/design-system`'s `theme.css`; the renderer's `src/style.css` imports Tailwind and that theme. No Tailwind or PostCSS config file is needed.

## Commands

Every task runs through Turbo, which orders it after the tasks it depends on. Use `pnpm turbo <task>`, or `turbo <task>` with Turbo installed globally:

```sh
pnpm turbo dev           # Run the app with HMR
pnpm turbo check         # TypeScript checks, including generated route types
pnpm turbo lint          # Oxlint
pnpm turbo test          # Each package's tests, cached per package (e2e builds the app first)
pnpm turbo test:ui       # Each package's tests in its own Vitest UI (pick one with -F)
pnpm turbo test:all      # Every test as Vitest projects, in one run
pnpm turbo test:all:ui   # Every test as Vitest projects, in one Vitest UI
pnpm turbo format        # Oxfmt: write formatting
pnpm turbo format:check  # Oxfmt: check formatting
pnpm turbo build         # Compile all processes and generate the renderer SPA
pnpm turbo start         # Build, then open the production build
pnpm turbo package       # Build an unpacked application under out/release/
pnpm turbo dist          # Build installers and update metadata under out/release/
pnpm changeset           # Record a patch, minor, or major app change
```

Each package's `package.json` scripts are plain commands for that package, and its own `turbo.jsonc` declares its outputs. Each process owns its build command and output cache; shared packages export source and are checked by `turbo check`. Builds follow package build dependencies without running type checks. Formatting remains a single repository-wide task.

The root manifest is explicitly included in `pnpm-workspace.yaml` so Changesets can version the app, which also makes it the `electron-starter` package to Turbo. Its scripts therefore never call Turbo themselves; `turbo.jsonc` addresses them as root tasks, `//#<task>`.

All generated output lives in `out/`: the process builds in `out/main`, `out/preload` and `out/renderer`, and electron-builder's packages in `out/release`. Main/preload dependencies are bundled, with Electron and Node built-ins external. Native addons would need explicit externalization and packaging support when added.

The renderer runs sandboxed with context isolation and Node integration disabled. Add privileged operations as explicit methods in `AppAPI` and the preload bridge, with corresponding main-process IPC handlers.

## Photo API

`window.app.photos` exposes directory browsing and on-demand thumbnails. Each selected folder has a utility process; closing, replacing, or reloading its window stops that process and its work. Opening a folder gives the window a `MessagePort` to that process, so scans, inspections, thumbnails, renames, and change events go straight between them; the worker answers the window only those methods and checks every argument. Main handles the folder picker, menus, video stills from the system's thumbnailer, and the `media:` URLs that serve thumbnails and originals.

```ts
const photos = window.app.photos;
const folder = await photos.openFolder();
if (folder) {
  const scanId = await photos.startScan({ directoryId: folder.id });
  try {
    let done = false;
    while (!done) {
      const batch = await photos.nextBatch(scanId);
      // Merge entries by ID, handle per-entry errors, then sort in the renderer.
      done = batch.done;
    }
  } finally {
    await photos.cancelScan(scanId);
  }
}
```

- `startScan({ directoryId, recursive?, metadata? })` creates a lazy scan. `nextBatch(scanId)` pulls at most 128 entries/errors. Only one pull per scan is allowed; cancel abandoned scans. Recursive scans, which the filmstrip uses, go breadth first with one folder open at a time, so the shallowest photos arrive first however deep the tree. Metadata includes size and timestamps, using filesystem birth time for creation time.
- `inspectFolder(directoryId)` reports `hasEntries`, `hasSubfolders`, and a cover candidate **directly inside that folder**. It never searches descendants or decodes pixels. A failed inspection rejects instead of reporting an empty folder. Scans and inspections share folder summaries, which last until the watcher sees the folder change or `refresh()` clears them.
- `requestThumbnail(entryId)` returns a ready image URL, `frame-needed` for a video only the window can take a still of (`storeThumbnail`), or a failure. Concurrent requests share a generation job; cached thumbnails skip the queue.
- `getOriginalURL(entryId)` returns an image URL scoped to the current folder session. `closeFolder()` disposes the session. IDs are opaque and valid only for their selected folder.
- `onChange(listener)` reports entries added, removed, renamed, or rewritten on disk, as the worker's recursive `fs.watch` sees them, in batches of up to a quarter second.

Scans skip symlinks and common OS metadata files. Supported thumbnail inputs are JPEG, PNG, WebP, GIF (first frame), AVIF, and TIFF. Native/platform decoder support can vary. Browser support for viewing the original is separate from Sharp's thumbnail support; video and RAW are not included yet.

Thumbnails are EXIF-oriented WebP images bounded to 384×384 without enlargement. Image jobs run on half the CPU cores (at least two), with one libvips thread per image. Cache keys include the file's identity on disk (device and inode, or its path where a disk reports none), size, modification time, and pipeline version, so renaming a file or folder keeps its thumbnails. Writes are atomic, and cleanup targets a 512 MiB disk budget, running at start and after every 25 MiB written.

Run `pnpm turbo test` for every package's tests, or filter to one package, such as `pnpm turbo test -F @prism/main` for main-process tests or `pnpm turbo test -F @prism/e2e` for the end-to-end tests. Each package's `test` script also runs on its own (`pnpm -F @prism/keybindings test`), but only Turbo builds the app before the end-to-end tests. Tests live in `__tests__` directories and use `*.test.ts` filenames. End-to-end tests live in the `e2e` package, in `e2e/tests` with their recorded screenshots, and launch the built app with Playwright's Electron driver through the fixtures and helpers in `e2e/support` (imported as `#support/*`); the app keeps its window hidden unless a run passes `--mode headed` to watch, as in `pnpm turbo test -F @prism/e2e -- --mode headed`. Going full screen shows even a hidden window, so the full-screen tests only run headed, as CI runs them. Sharp is external to the bundle, declared in both the main workspace and root application manifests, and unpacked with its native binaries by electron-builder. The root runtime dependency is needed for packaged dependency collection; pnpm installs both CPU variants for the macOS release job. Local module imports use `package.json#imports`; `#photos/*` is shared by the application and Vitest.

## Releases and automatic updates

The Checks workflow runs lint, type checking, tests, and formatting on pull requests targeting `main`, under Xvfb so the end-to-end tests have a display. These checks are separate from release builds.

The release workflow builds macOS (arm64 and x64), Windows (x64 NSIS), and Linux (x64 AppImage) on native GitHub runners. Two small local actions handle preview versioning and trusting the macOS test certificate. Changesets manages the release PR, and electron-builder uploads the installers to a draft release that the workflow publishes once every platform is in.

1. Run `pnpm changeset`, select `electron-starter`, and describe the change. Internal process/shared packages stay private and do not get separate releases.
2. Merge changes into `main`. Each push builds a preview of the next planned version, such as `0.2.0-next.123.1`. With no pending changeset it previews the next patch instead. Snapshot versions are only applied in the build checkout.
3. Changesets maintains a **Release app version** PR containing the final version, changelog, consumed changesets, and regenerated lockfile.
4. Merge that PR to build the stable version, such as `0.2.0`.

After all platform builds succeed, the workflow uploads installers, blockmaps, and `latest*.yml` metadata to a draft GitHub release in this repository, then publishes it. Previews are marked as GitHub prereleases; stable releases are normal releases. Builds never publish npm packages. Each release's notes are its changelog section, with the pull request and author that `@changesets/changelog-github` looks up for every changeset; a preview lists the changesets still pending.

The release PR is opened by a GitHub App rather than `GITHUB_TOKEN`, because GitHub doesn't start workflows for pull requests made with `GITHUB_TOKEN`, so the Checks would wait for approval. To set it up once:

1. Create a private GitHub App under your account's **Developer settings**, with no webhook and the repository permissions **Contents: Read and write** and **Pull requests: Read and write**.
2. Install the app on this repository only.
3. Add its client ID as the repository variable `RELEASE_APP_CLIENT_ID`, and a private key generated on the app's page as the repository secret `RELEASE_APP_PRIVATE_KEY`.

Packaged applications check for updates on startup, download them in the background, and install downloaded updates on normal quit. Development and `pnpm start` skip update checks. Stable installations ignore previews; preview installations can receive prereleases. `electron-builder.yml` defines the app identity, installers, and update provider. Keep the app ID and signing identity consistent across versions.

This repository is private. Each installed app needs a per-user `GH_TOKEN` (or `GITHUB_TOKEN`) with read access to this repository's releases in its launch environment. A token with repository Contents read permission is enough; never embed the CI publishing token in the app. A Finder launch does not inherit shell variables, so launch from the terminal while testing:

```sh
GH_TOKEN=your-read-only-token '/Applications/Prism.app/Contents/MacOS/Prism'
```

### Self-signed macOS test builds

Notarization is disabled. The workflow uses a persistent self-signed code-signing identity, which must be trusted on test Macs. Apple does not notarize self-signed apps, so this setup is for controlled testing. Use the same certificate for the initial installation and every update; ad-hoc signatures do not provide that persistent identity.

Create a **Self Signed Root** certificate of type **Code Signing** with Keychain Access's Certificate Assistant. Export its identity (certificate and private key) as a password-protected `.p12`, and export the public certificate as `.cer`. Store these files under `.context/` and configure these repository Actions secrets:

| Secret                 | Value                                    |
| ---------------------- | ---------------------------------------- |
| `CSC_LINK`             | Base64-encoded `.p12` signing identity   |
| `CSC_KEY_PASSWORD`     | Password used when exporting the `.p12`  |
| `MAC_SELF_SIGNED_CERT` | Base64-encoded public `.cer` certificate |

The local signing action trusts the public certificate on the disposable macOS runner; electron-builder imports the `.p12` and signs the app. Certificate trust runs with noninteractive administrator privileges and a timeout so an authorization prompt cannot stall the release indefinitely. It fails if no signing identity is available. No Apple Developer account or notarization credentials are needed for these test builds.

On a test Mac, import the public certificate into Keychain Access and explicitly trust it for code signing before testing an installed build and its update. The initial download can still trigger Gatekeeper's unnotarized-app prompt. Certificate creation, repository secrets, and local trust are setup steps; they are not performed by `pnpm install`.

Windows signing is optional for testing. Supply `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` repository secrets when you have a Windows signing identity. A signed, installed two-version update must be tested before distributing the app.

## License

Prism is free software under the [GNU General Public License v3.0](LICENSE). You may use, change and share it, and anything you distribute that is built from it must be released under the same license, with its source code.
