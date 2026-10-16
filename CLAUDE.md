# Working in this repo

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
- **Design system** (`@app/design-system`): build UI from its components, and add new shared
  pieces there rather than in the renderer.
- **Others**:
  - `@tanstack/react-virtual` for long lists.
  - `tw-shimmer` for shimmer effects.
  - `lucide-react` for icons.
  - Electron's native window features (vibrancy, the hidden title bar, drag regions) instead
    of imitating them in CSS.
  - `electron-updater` for updates.
  - Vitest for tests.
  - Changesets for release notes.

## Dependencies

Packages are pinned through the pnpm catalog in `pnpm-workspace.yaml`. Respect
`minimumReleaseAge`. If a version is too new, pin an older one instead of adding an exclusion.

## Checks

Run `pnpm lint`, `pnpm check` and `pnpm format:check` before finishing. Don't commit or push
unless asked.
