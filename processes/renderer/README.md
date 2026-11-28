# @prism/renderer

The window: the React app that shows a library. It is a React Router app in SPA mode, built
with Vite, and it reaches the rest of Prism only through `globalThis.app`, which the
[preload](../preload/README.md) gives it. It has no access to Node, Electron or the disk. How
it fits into the app is in [docs/architecture.md](../../docs/architecture.md).

## Layout

| Where             | What it holds                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/`     | The screens, one route module each, named and nested as `remix-flat-routes` reads them. Each loads what it needs to show.                                   |
| `src/components/` | The React components, a folder per feature of the window, such as the folder tree or the viewer.                                                            |
| `src/data/`       | Everything that isn't React, mostly a folder per feature: the library's session and its queries, the route loaders, and the stores components subscribe to. |
| `src/hooks/`      | Hooks that several features use to read `data/`.                                                                                                            |
| `src/keyboard/`   | Keys and commands: the keymap from `@prism/keybindings`, and how a command finds what handles it.                                                           |
| `src/`            | Loose files here are only the ones React Router expects there, the stylesheet and type declarations.                                                        |

### Components and data

A library's session lives in `data/session/`, one per open folder. It owns the folder's query
cache, its views, its tree and its media cache, apart from React and routing, so it is easy to
test and outlives any one screen. The other folders in `data/` hold the parts a session is made
of, and the few stores that belong to the window rather than a folder, such as what the main
process says about updates.

A component reads that state in one of three ways: a query with `useSuspenseQuery`, a store with
`useSyncExternalStore`, or a promise a loader started, with `use()`.

## Rules

These follow AGENTS.md's [React Router and React 19](../../AGENTS.md#prefer-the-libraries-own-patterns)
rules:

- **Data loads in route modules.** A route's `clientLoader` waits for what the first frame needs,
  so a navigation commits only once it can show something. Changes go through a `clientAction`,
  and `shouldRevalidate` says when a loader runs again. Don't render a view and then fetch in an
  effect.
- **No data or derived state in `useEffect`.** Read stores with `useSyncExternalStore`, cached
  promises with `use()` and Suspense, and measure the DOM with ref callbacks.
- **State that outlives a component lives in `data/`,** as a plain module or class with a
  `subscribe` and a snapshot, and its tests are unit tests that need no React.
- **The window doesn't patch lists.** When the worker says a view has a new version, the view
  reads its range again.
- **Edits show at once and revert if they fail.** They stay pending edits in `data/` until the
  worker confirms them.
- **Build UI from `@prism/design-system`.** A piece another screen could use goes there, not in
  `components/`. Long lists use `@tanstack/react-virtual`.
- **A hook or helper lives with what uses it.** One used by a single component sits beside it;
  one that several features use goes in `hooks/`.
- **Imports:** `@prism/shared`'s main entry, `@prism/design-system` and `@prism/keybindings`, never
  Node, Electron or a Node-only entry.

## Tests

Logic in `data/` gets unit tests (`*.test.ts`). What a component shows gets a component test
(`*.test.tsx`), which renders it in Chromium inside a library with a fake `globalThis.app`, using
the helpers in `components/__tests__/`. Each folder keeps its tests in its own `__tests__/`. See
AGENTS.md's [Tests](../../AGENTS.md#tests) for when to write which.
