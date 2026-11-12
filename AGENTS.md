# Working in this repo

The README is for people using Prism. How it is built lives in `docs/`: `development.md`,
`architecture.md` and `releasing.md`. Update whichever describes what you change.

## Prefer the libraries' own patterns

Before writing custom code, check whether a library we already use solves the problem, and use
its idiomatic approach. Read its docs when unsure. Only reach for something hand-rolled when the
library genuinely has no answer, and say why in a comment.

- **React Router** (SPA mode): data belongs in route modules. Use `clientLoader` and
  `clientAction` to load and mutate, `shouldRevalidate` to control reloading, `useNavigation`
  for pending state, and `viewTransition` for crossfades. A navigation should not commit until
  its loader has what the first frame needs, so don't render a view and then fetch in an effect.
- **React 19**: don't load data or derive state in `useEffect`. Use `use()` with Suspense for
  cached promises, `useSyncExternalStore` for external stores, ref callbacks with cleanup for
  DOM measurement and observers, and transitions or deferred values for non-urgent updates.
- **remix-flat-routes**: add screens as route files that follow the existing `+` folder,
  `_layout` and `_index` conventions under `processes/renderer/src/routes`, rather than
  wiring routes by hand.
- **Tailwind v4**: use theme tokens and the built-in utilities and variants (`aria-*`,
  `group-*`, `inset-ring`, `text-shadow-*`, `--alpha()` and so on) before arbitrary values or
  inline styles. Add a new token to `@theme` in `packages/design-system/src/theme.css` instead
  of repeating a one-off value, and use `@utility` for reusable combinations.
- **Design system** (`@prism/design-system`): build UI from its components, and add new shared
  pieces there rather than in the renderer.
- **Base UI** (`@base-ui/react`) and the platform: the renderer is always Chromium, so use the
  native element when it covers the behaviour: `<dialog>` for modals, a customizable `<select>`
  for pop-up menus, `popover="hint"` with `interestfor` for tooltips, `<input type="range">`
  for sliders, and Electron's `Menu` for context menus. Reach for Base UI for composite widgets
  the platform lacks, such as a combobox, a toggle group or a toolbar with arrow-key focus, and
  for `useRender` when a component takes a `render` prop. Neither has a tree or a virtualized
  listbox, so the folder tree and the collection keep their own keyboard handling.
- **Turborepo**: turbo is the entry command for every task (`pnpm turbo <task>`). Keep
  `package.json` scripts plain commands for their own package, and model how tasks depend on
  each other in `turbo.jsonc` (`dependsOn`, `outputs`, `env`) instead of chaining commands like
  `pnpm build && …`. Put a package's own task settings in that package's `turbo.jsonc`. The root
  is also the `prism` package, so its scripts never call turbo.
- **Others**:
  - `@tanstack/react-virtual` for long lists.
  - `tw-shimmer` for shimmer effects.
  - `lucide-react` for icons.
  - Electron's native window features (vibrancy, the hidden title bar, drag regions) instead
    of imitating them in CSS.
  - `electron-updater` for updates.
  - Vitest for tests: unit and component suites from `@prism/vitest-config`, with component
    tests in Vitest Browser Mode, and Playwright's Electron driver for end-to-end tests in
    `e2e/`. See [Tests](#tests) for which to write.
  - Changesets for release notes.

## Tests

Prefer the smallest test that shows the behaviour: unit tests first, then component tests, and
end-to-end tests only as a last resort. A unit test, a `*.test.ts` file that Vitest runs
without a browser, is the fastest and the most precise about what broke, so when logic can be
tested apart from React and the DOM, test it there, and pull it out of a component into a plain
function if that's what it takes.

Otherwise, write a component test, not an end-to-end test, for anything a renderer component
shows on its own: render it with `renderInLibrary` and a fake API, as the tests in
`processes/renderer/src/components/__tests__` do. End-to-end tests are slow and launch the whole
app, so keep them for what only the real app shows: the main process, native windows and
menus, real files on disk, and flows across several screens. Before adding one to `e2e/`, say
why a component test can't show the behaviour.

Every test goes through Vitest, with Playwright driving the browser or the app. Never check
behaviour with a script run straight in Node.

## Dependencies

Packages are pinned through the pnpm catalog in `pnpm-workspace.yaml`. Respect
`minimumReleaseAge`. If a version is too new, pin an older one instead of adding an exclusion.

## Checks

Run `pnpm turbo lint check test format:check knip` and `pnpm turbo boundaries` before
finishing. To run every test while iterating, use `pnpm turbo test:all` (or
`pnpm turbo test -F <package>`), never the `:ui` tasks: they open a browser and never exit.

When a task is done and the checks pass, open a pull request without waiting to be asked: work
on a branch off `main`, commit, push and create the PR, and say what it leaves untested. Don't
commit or push work that is unfinished, fails its checks, or still waits on a decision.

Checks must never take over the user's screen. The end-to-end tests run the app headless by
default, so don't pass `--mode headed` locally: only CI does, under Xvfb. If a run shows a
window anyway, stop and report which test did it, and don't rerun it.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": true` in the root `turbo.json` or `turbo.jsonc` to opt in; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
