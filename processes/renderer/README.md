# @prism/renderer

The window: the React app that shows a library. It is a React Router app in SPA mode, built
with Vite, and it reaches the rest of Prism only through `globalThis.app`, which the
[preload](../preload/README.md) gives it. It has no access to Node, Electron or the disk. How
it fits into the app is in [docs/architecture.md](../../docs/architecture.md).

## Layout

| Where             | What it holds                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/`     | The screens, one route module each, named as `remix-flat-routes` reads them. Each loads what it needs to show.                              |
| `src/components/` | The React components, a folder per feature: `collection/`, `folder-tree/`, `gallery/`, `preview/`, `trash/` and `viewer/`.                  |
| `src/data/`       | Everything that isn't React: the library's session, the queries and their cache, the route loaders, and the stores components subscribe to. |
| `src/hooks/`      | Hooks that several features use to read `data/`, such as `useLibrary`, `useView…` and `useRating`.                                          |
| `src/keyboard/`   | Keys and commands: the keymap from `@prism/keybindings`, and how a command finds what handles it.                                           |
| `src/*.ts(x)`     | React Router's own files (`root.tsx`, `routes.ts`, `entry.client.tsx`, `entry.server.tsx`) and the stylesheet. Nothing else.                |

### Routes

| Route file                                                   | Screen                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `root.tsx`                                                   | The document. Its loader reads the keymap and the accent colour before the first frame.      |
| `_browser+/_layout.tsx`                                      | The window, and the notices over every screen: errors, updates, a catalog upgrade.           |
| `_browser+/_index.tsx`                                       | The welcome screen, before a folder is open.                                                 |
| `_browser+/library+/_layout.tsx`                             | An open library. Its action takes the edits (ratings, renames, the Trash) and opens folders. |
| `_browser+/library+/grid.tsx`, `filmstrip.tsx`, `reader.tsx` | The ways to view a folder, each loaded by `loadGallery` in `data/route-loaders.ts`.          |
| `_browser+/library+/trash.tsx`                               | Prism's Trash.                                                                               |
| `design-system.tsx`                                          | The design system's catalog, in development only.                                            |

### Components and data

`data/session/library-session.ts` holds `LibrarySession`, one per open folder. It owns the folder's TanStack Query
client, its views, its tree and its media cache, apart from React and routing, so it is easy to
test and outlives any one screen. Feature folders in `data/` (`tree/`, `views/`, `edits/`,
`trash/`, `activity/`, `media/` and `preferences/`) hold the parts a session is made of. Two
things in `data/` belong to the window rather than a session: `notices/`, what the main process
says about updates and catalog upgrades, and `accent-color.ts`, the system's accent colour.

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
- **Edits show at once and revert if they fail.** They are pending edits in `data/edits/` until
  the worker confirms them.
- **Build UI from `@prism/design-system`.** A piece another screen could use goes there, not in
  `components/`. Long lists use `@tanstack/react-virtual`.
- **A hook or helper lives with what uses it.** One used by a single component sits beside it,
  as `components/use-visible.ts` sits beside `thumbnail.tsx`; one that several features use goes
  in `hooks/`.
- **Imports:** `@prism/shared`'s main entry, `@prism/design-system` and `@prism/keybindings`, never
  Node, Electron or a Node-only entry.

## Tests

Logic in `data/` gets unit tests (`*.test.ts`). What a component shows gets a component test
(`*.test.tsx`), which renders it in Chromium with `renderInLibrary` from
`components/__tests__/render.tsx` and a fake `globalThis.app`. Each folder keeps its tests in its
own `__tests__/`. See AGENTS.md's [Tests](../../AGENTS.md#tests) for when to write which.
