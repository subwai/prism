# @prism/main

Electron's main process, and the processes it starts. It makes the window and the menu bar,
checks for updates, serves the app's pages and the `media:` URLs, and starts a photo worker for
each library the user opens. How it fits into the app is in
[docs/architecture.md](../../docs/architecture.md).

## Three programs in one package

The build makes three programs from this folder, one for each top-level entry file:

| Entry file          | Runs in                                        | What it does                                               |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| `index.ts`          | the main process                               | starts the app: its window, menu, protocols and updates    |
| `photos-worker.ts`  | a utility process for each library that's open | reads the library's folder and keeps its catalog           |
| `catalog-thread.ts` | threads of that worker                         | runs `@prism/catalog`'s writer and readers, off its thread |

They share no memory, so they talk through messages, and the types of those messages live in
`@prism/shared` or in `photos/messages.ts`.

## Layout

| Where                 | What it holds                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/window/`         | The application window: making it, remembering its size and place, its background, full screen, and the system's accent colour it follows.                            |
| `src/keybindings/`    | The user's `keybindings.json`: reading it, following edits to it, and opening it in an editor. The rules for keys are in `@prism/keybindings`.                        |
| `src/menu.ts`         | The menu bar.                                                                                                                                                         |
| `src/updater.ts`      | Checking for updates and installing them, with `electron-updater`.                                                                                                    |
| `src/app-protocol.ts` | The `app:` protocol, which serves the built window's pages; `renderer-url.ts` says where those pages are.                                                             |
| `src/devtools.ts`     | React DevTools, in development only.                                                                                                                                  |
| `src/photos/main/`    | The main process's side of a library: the calls the window makes, the folder sessions, the client that starts each worker, and where the catalog and cache files are. |
| `src/photos/worker/`  | The photo worker. Its [README](src/photos/worker/README.md) says what each of its folders is for.                                                                     |
| `src/photos/*.ts`     | What both sides of a library share: `messages.ts`, the messages between main and a worker, and `validate.ts`, which checks what a window sends.                       |

`photos/main/` groups two features in folders of their own: `remembered-folders/`, the small
JSON files that remember the last library and, per library, the folder shown and the folders
open in the tree; and `media-protocol/`, which serves thumbnails and originals as `media:` URLs.

## Rules

- **Nothing the window asks main for waits for the share,** except an original photo or video it
  asked to see. Main serves a cached thumbnail from the cache by its key, without asking the
  worker, and leaves reading the library's folders to the worker.
- **Main and the worker don't import each other.** Nothing in main imports `photos/worker/`, and
  the worker imports neither `electron` nor main's files, because it runs in its own process.
  Only `photos-worker.ts` imports the worker, to start it. Both may import `photos/*.ts`.
- **Check what a window sends.** Main's handlers check that a call came from the app's own page
  (`isRendererURL`). Main and the worker check a call's arguments with `photos/validate.ts`
  before using them.
- **Channel names and the window's API live in `@prism/shared`**, so main, the preload and the
  window use the same names and types.
- **Group by feature.** Once a folder holds more than about ten files, move them into folders
  named for what they do, as `window/` and `photos/main/media-protocol/` are. The folder
  names the feature, so files in it don't repeat it: `window/background.ts`, not
  `window/window-background.ts`.

## Where new code goes

| You're adding                                  | Put it in                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| A call from the window about a library         | a handler in `photos/main/ipc.ts`, or a method on the worker if it reads the library  |
| A call from the window about the window itself | a module in `window/`, with its channels in `@prism/shared` and the preload's API     |
| A menu item                                    | `menu.ts`, with its command and key in `@prism/keybindings`                           |
| Work on the library's files or its catalog     | the worker; see [its README](src/photos/worker/README.md#where-new-code-goes)         |
| A general mechanism, such as a queue           | `@prism/shared`; see [its README](../../packages/shared/README.md#general-mechanisms) |
