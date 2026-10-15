# Electron starter

A small pnpm workspace with TypeScript, Electron, React Router framework mode, and Tailwind CSS.

## Run

The root `devEngines` configuration pins pnpm 12.11.2 and selects Node.js `^24.4.0`. pnpm downloads the configured package manager and runtime when needed; CI reads the same configuration through `pnpm/setup`.

```sh
pnpm install
pnpm dev
```

Click **Ping main process** to exercise the typed renderer → preload → main bridge. It responds with `pong`. The About route demonstrates navigation and a typed `clientLoader` that calls the bridge.

## Layout

```text
processes/
  main/src/           # Electron lifecycle, windows, local app protocol
  renderer/src/       # React Router root, routes, and styles
  preload/src/        # Narrow contextBridge API exposed as window.app
packages/
  shared/src/         # Shared constants and API types
  typescript-configs/ # Strict base, Node, and browser configs
scripts/dev.ts        # Renderer dev server and Electron build watchers
```

Every process has its own `package.json`, dependencies, and `tsconfig.json`. Add reusable packages under `packages/**`, declare them with `workspace:*` in the consuming process, and import by package name. Keep shared browser code free of Node/Electron imports.

## TypeScript, ESM, and imports

Adapted from [example-monorepo](https://github.com/subwai/example-monorepo#how-packages-resolve):

- Every workspace declares `"type": "module"` and uses ESM source. Main builds to ESM; the sandboxed preload builds to one `.cjs` file.
- Shared configs live in `@app/typescript-configs`. Main and preload use `NodeNext`; the renderer uses `Preserve`/`Bundler`. Each workspace checks independently; the root config checks build tooling.
- Package-local aliases use native `package.json` `imports`, with `#*` pointing to source. For example: `#window`, `#constants`, and `#style.css`. No TypeScript `paths` or Vite alias table is needed.
- Shared packages export source through `exports` and are bundled into consumers. There is no `dist` prerequisite for development or checking.
- TypeScript enables the `development` condition. Current shared packages resolve to source in both development and production builds.
- Third-party versions live in the pnpm workspace `catalog`, with dependencies declared by each consuming workspace.

Renderer generated types also use package imports:

```ts
// src/root.tsx
import type { Route } from '#types/root';
// src/routes/about.tsx
import type { Route } from '#types/routes/about';
```

`pnpm check` runs React Router type generation before checking the renderer. Generated files under `.react-router/` are ignored by Git. Source aliases resolve during bundling; Electron runs the resulting JavaScript.

## React Router

The renderer uses [framework mode in SPA mode](https://reactrouter.com/how-to/spa): the Vite plugin, `src/root.tsx`, route modules registered in `src/routes.ts`, generated route types, and `clientLoader`/`clientAction` support. `ssr: false` removes the runtime server. The small server entry renders the root shell at build time; keep initial renders free of browser-only APIs and access `window.app` in client loaders or event handlers.

React Router owns the renderer's Vite config and production build. The dev runner uses electron-vite's main/preload build presets and connects their watchers to the renderer server:

- Renderer components: React Fast Refresh preserves component state. CSS updates in place.
- Main: rebuilds, stops the old Electron process, then starts the new one.
- Preload: rebuilds and reloads the renderer.
- Imported shared packages: watched by their consumers.

The production renderer loads at `app://app/`. A local protocol handler serves assets and falls back to the SPA shell for page URLs, so browser-history routes and refreshes work. No HTTP server runs in production.

## Styling

Tailwind CSS uses the [Vite plugin](https://tailwindcss.com/docs/installation/framework-guides/react-router) in the renderer. Add utility classes directly in route components; CSS updates through Vite HMR. `src/style.css` imports Tailwind and keeps the starter styles in `@layer base`, so utilities can override them. No Tailwind or PostCSS config file is needed.

## Commands

```sh
pnpm check         # TypeScript checks, including generated route types
pnpm lint          # Oxlint
pnpm format        # Oxfmt: write formatting
pnpm format:check  # Oxfmt: check formatting
pnpm build         # Compile all processes and generate the renderer SPA
pnpm start         # Open the existing production build
pnpm package       # Build an unpacked application under release/
pnpm dist          # Build installers and update metadata under release/
pnpm changeset     # Record a patch, minor, or major app change
```

Turbo runs the package build, check, and lint tasks. Each process owns its build command and output cache; shared packages export source and are checked by `pnpm check`. Builds follow package build dependencies without running type checks. The root development task keeps the coordinated Electron/HMR runner. Formatting remains a single repository-wide command.

The root manifest is explicitly included in `pnpm-workspace.yaml` so Changesets can version the app. Turbo commands exclude its `electron-starter` workspace alias to avoid recursively running the root wrapper scripts. Root tooling checks run as Turbo root tasks.

Build output lives in `out/`. Main/preload dependencies are bundled, with Electron and Node built-ins external. Native addons would need explicit externalization and packaging support when added.

The renderer runs sandboxed with context isolation and Node integration disabled. Add privileged operations as explicit methods in `AppAPI` and the preload bridge, with corresponding main-process IPC handlers.

## Releases and automatic updates

The Checks workflow runs lint, type checking, and formatting on pull requests targeting `main`. These checks are separate from release builds. GitHub may require **Approve workflows to run** on the release PR created by `GITHUB_TOKEN` before its checks start.

The release workflow builds macOS (arm64 and x64), Windows (x64 NSIS), and Linux (x64 AppImage) on native GitHub runners. Two small local actions handle preview versioning and trusting the macOS test certificate. Changesets manages the release PR, and `ncipollo/release-action` uploads and publishes the installers.

1. Run `pnpm changeset`, select `electron-starter`, and describe the change. Internal process/shared packages stay private and do not get separate releases.
2. Merge changes into `main`. Each push builds a preview of the next planned version, such as `0.2.0-next.123.1`. With no pending changeset it previews the next patch instead. Snapshot versions are only applied in the build checkout.
3. Changesets maintains a **Release app version** PR containing the final version, changelog, consumed changesets, and regenerated lockfile.
4. Merge that PR to build the stable version, such as `0.2.0`.

After all platform builds succeed, the workflow uploads installers, blockmaps, and `latest*.yml` metadata to a draft GitHub release in this repository, then publishes it. Previews are marked as GitHub prereleases; stable releases are normal releases. Builds never publish npm packages. Enable **Allow GitHub Actions to create and approve pull requests** in the repository's Actions settings for the release PR step.

Packaged applications check for updates on startup, download them in the background, and install downloaded updates on normal quit. Development and `pnpm start` skip update checks. Stable installations ignore previews; preview installations can receive prereleases. `electron-builder.yml` defines the app identity, installers, and update provider. Keep the app ID and signing identity consistent across versions.

This repository is private. Each installed app needs a per-user `GH_TOKEN` (or `GITHUB_TOKEN`) with read access to this repository's releases in its launch environment. A token with repository Contents read permission is enough; never embed the CI publishing token in the app. A Finder launch does not inherit shell variables, so launch from the terminal while testing:

```sh
GH_TOKEN=your-read-only-token '/Applications/Electron starter.app/Contents/MacOS/Electron starter'
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
