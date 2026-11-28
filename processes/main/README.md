# @prism/main

Electron's main process, and the processes it starts. It makes the window and the menu bar,
checks for updates, serves the app's pages and the `media:` URLs, and starts a photo worker for
each library the user opens. How it fits into the app is in
[docs/architecture.md](../../docs/architecture.md).

## Three programs in one package

The build makes three programs from this folder. Each starts from an entry file at the top of
`src/`, which the build config names:

| Program            | Runs in                                        | What it does                                            |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------- |
| the main process   | the app's main process                         | starts the app: its window, menu, protocols and updates |
| the photo worker   | a utility process for each library that's open | reads the library's folder and keeps its catalog        |
| the catalog thread | threads of that worker                         | runs `@prism/catalog`'s writer and readers              |

They share no memory, so they talk through messages, whose types live in `@prism/shared` or
beside the photo code in `photos/`.

## Layout

| Where                | What it holds                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/window/`        | The application window and what it asks of the system, such as its size and place, full screen and the accent colour.                         |
| `src/keybindings/`   | The user's `keybindings.json`: reading it, following edits, and opening it. The rules for keys are in `@prism/keybindings`.                   |
| `src/photos/main/`   | The main process's side of a library: the calls the window makes about it, the folder sessions, and starting each worker. Grouped by feature. |
| `src/photos/worker/` | The photo worker. Its [README](src/photos/worker/README.md) says what each of its folders is for.                                             |
| `src/photos/`        | Loose files here are what both sides of a library share: the messages between them, and the checks on what a window sends.                    |
| `src/`               | Loose files here are the entry files and the app-wide parts with one module each, such as the menu bar, updates and the `app:` protocol.      |

## Rules

- **Nothing the window asks main for waits for the share,** except an original photo or video it
  asked to see. Main serves a cached thumbnail from the cache by its key, without asking the
  worker, and leaves reading the library's folders to the worker.
- **Main and the worker don't import each other.** Nothing in main imports `photos/worker/`, and
  the worker imports neither `electron` nor main's files, because it runs in its own process.
  Only the worker's entry file imports it. Both may import what `photos/` shares.
- **Check what a window sends.** Main's handlers check that a call came from the app's own page,
  and both sides check a call's arguments with the shared checks in `photos/` before using them.
- **Channel names and the window's API live in `@prism/shared`**, so main, the preload and the
  window use the same names and types.
- **Group by feature.** Once a folder holds more than about ten files, move them into folders
  named for what they do. The folder names the feature, so files in it don't repeat it:
  `window/background.ts`, not `window/window-background.ts`.

## Where new code goes

| You're adding                                  | Put it in                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| A call from the window about a library         | `photos/main/`, or the worker if it reads the library or its catalog                  |
| A call from the window about the window itself | `window/`, with its channel in `@prism/shared` and its method in the preload's API    |
| A menu item                                    | the menu bar's module, with its command and key in `@prism/keybindings`               |
| Work on the library's files or its catalog     | the worker; see [its README](src/photos/worker/README.md#where-new-code-goes)         |
| A general mechanism, such as a queue           | `@prism/shared`; see [its README](../../packages/shared/README.md#general-mechanisms) |
