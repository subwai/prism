# The photo worker

Each library Prism opens (the folder you chose) gets a worker of its own, a separate process
that reads that folder and keeps its catalog. This folder is that worker's code. It is split into layers by what each part
talks to, and the folder a file is in names its layer, so files carry no layer suffix: it's
`disk/watcher.ts`, not `disk/watcher-disk.ts`.

## The layers

| Folder                                                                | What it's for                                                                                                                                                                           |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messages/`                                                           | Talks to the main process and the windows. It checks what arrives and passes it on, with no rules of its own: `backend.ts` answers calls, `frames.ts` asks the main process for stills. |
| `library/`                                                            | The library as a whole. `library.ts` opens a folder and joins the parts below.                                                                                                          |
| `indexer/`, `views/`, `on-screen/`, `changes/`, `edits/` and `trash/` | The services, a folder per feature. Each reads as short steps in the app's own words.                                                                                                   |
| `disk/`                                                               | Every call to the file system, as plain functions named for what they do on disk.                                                                                                       |
| `disk/share/`                                                         | What only a network share does: whether it is online, and whether a folder is on one.                                                                                                   |
| `scheduler/`                                                          | Orders the disk work by what the window shows: what's on screen, then what's just ahead, then the background.                                                                           |

The catalog has no folder here. The worker reaches it only through `@prism/catalog`'s client
(`Catalog`), so no SQL lives in the worker.

## The rules

- **Only `disk/` touches the file system.** No other folder imports `node:fs`, or the system
  Trash. A service calls a `disk/` function instead, so it reads as the app's steps.
- **Disk work that grows with the library goes through the scheduler.** That's reading folders,
  making thumbnails and reading photos' details. Actions the user asks for once, such as a
  rename, a rating or a run to the Trash, call `disk/` straight away, as do the checks that the
  share is online and the folder watcher.
- **A `disk/` function is a plain call.** It adds no wrapper object per entry and no extra look
  at the disk, because a library holds about two million entries on a share that answers slowly.
- **Services read as steps in the app's own words.** A general mechanism, such as a queue or a
  cache with a limit, goes in a module of its own, named for what it is.

## Where new code goes

| You're adding                                 | Put it in                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A new feature                                 | A new folder beside the services, or the service folder it belongs to. `library.ts` joins it to the rest.                      |
| A new kind of file-system call                | A function in `disk/`, named for what it does on disk. If only a network share needs it, in `disk/share/`.                     |
| A new call from the window or main process    | A method on `WorkerBackend` in `messages/backend.ts` that checks its arguments and calls a service. The service does the work. |
| A new message the worker sends without asking | `messages/`, as `activity-reports.ts` sends the status bar's activity.                                                         |
