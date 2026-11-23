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

## Readable code

This is the framework to work within, in the user's own words:

- When reading any function for the first time, it should make sense what's inside it. No
  function should be "magical", or have names or content that only make sense to an expert or
  to someone used to other files.
- If the function name or variable name isn't descriptive enough, the file name or folder
  structure should be. If that's not the case, reorganize.
- Comments explain things in a simple, understandable way, not in overly technical statements
  that readers have to be experts to follow.
- The aim is code that is easy to understand, not more technical names.
- Algorithms and the simple steps of business logic should be separated as cleanly as
  possible.

The rules below follow from it.

- **Names** say what a thing is or does, in words a newcomer to the app would use:
  `refreshFolderTiles`, not `retile`. No metaphors (`lender`, `news`, `heard`) and no words that
  need another file to explain them.
  - Functions start with a verb (`countUnreadPhotos`), values and types are nouns
    (`WriteResult`), and booleans read as a question (`isOffline`, `hasCovers`).
  - Each idea has one word across the codebase: "share" is the network share, so a fraction is
    not a `share`.
  - Keep short names (`i`, `db`, `id`) for a few lines' scope.
- **Files and folders:**
  - A file is named for its main export, or the one thing it does. Two files never differ only
    by a plural or a gerund (`trash-plan`, `trash-planner`, `trash-plans`).
  - Once a folder holds more than about ten files, group them in folders by feature (`trash/`,
    `views/`, `scheduling/`). The folder then says what the files are about, so their names can
    stay short.
  - A helper lives with what it helps. A general one goes in a module named for it, such as
    `fs-errors.ts`, not in whichever file needed it first.
- **Comments** explain simply. Write for someone smart who is new to the code: everyday words,
  short sentences, one idea each. Avoid both riddles and dense expert shorthand.
  - Say why, not what. If a comment only repeats the code, improve the name and delete the
    comment.
  - Lead with the point ("Returns the folders whose tiles changed."), then give the reason.
  - When a technical term is needed, use it, and explain it in a few words the first time a file
    uses it ("WAL, SQLite's write-ahead log").
  - Document each field of a type on its own line, not in a paragraph above the type.
  - Keep performance reasons and their numbers: "Parsed on first use: parsing all 40k tiles up
    front took most of the launch time."
- **Code shapes:**
  - A function does one thing at one level of detail. If it needs comments to separate its
    steps, split it into named functions.
  - A union type carries a `kind` field and is handled with a `switch`, not `'x' in value`
    chains.
  - Use an options object, not positional parameters, once there are more than three, or more
    than one optional parameter.
  - Return results rather than filling a caller's accumulators through a callback.
  - Compact formats kept for speed, such as tuples or offsets into a string, are encoded and
    decoded in one module named for the format. Everything else uses named fields.
  - General mechanisms, such as a job queue, a size-capped cache or a walk through folders, are
    written once, in a module named for the mechanism, with their own tests. Business logic
    uses them and reads as a short list of steps in the app's own words: what to read, what to
    keep, what to show. It doesn't build its own queue or cache along the way.

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

Close every Electron app a test run starts: no `e2e-profile` process should outlive it. Other
agents often share the machine, so check `uptime` before trusting a timing or an end-to-end
failure. Under heavy load or if the Mac sleeps mid-run (`pmset -g log`), tests fail in ways that
aren't bugs. To check end-to-end tests gently, run
`caffeinate -i nice -n 10 pnpm exec vitest run --no-file-parallelism` in `e2e/`. A design-system
screenshot that drifts by a few antialiased pixels is usually a GPU or macOS update. Re-record
that one baseline by copying its `.actual.png` over it, not with `-u`, which rewrites them all.

## Pull requests and reviews

- **Stacks:** work in layers, each PR built on the last, goes in a native GitHub stack with the
  `gh stack` extension, from the second layer on, whether or not anyone asked for a stack.
  Start it with `gh stack init <branches, bottom first>` and `gh stack submit`, or use
  `gh stack link <PRs>` for PRs that already exist. Restack with `gh stack rebase` or
  `gh stack sync`.
- **Simple code:** a review checks maintainability and readability, not only correctness and
  speed. Ask whether the design is the simplest that does the job. Look for:
  - two mechanisms doing one job;
  - modes switched by flags or optional callbacks;
  - special cases kept only for a transition;
  - state that could be derived;
  - names, files or comments that break [Readable code](#readable-code).

  In the catalog, keep SQL in `repositories/`, one file per table, and compose queries in
  `services/`; opening a database belongs in `database/`. See `packages/catalog/README.md`. For classes, see
  [Classes and functions](docs/development.md#classes-and-functions).

- **Clean up after yourself:** delete probes and leftovers as soon as they've served their
  purpose. That covers catalog copies, disk images, scratch files, synthetic libraries,
  diagnostic branches (local and remote), probe PRs, and local checkouts of merged PRs. Keep
  anything that may be real unfinished work, and say so instead of deleting it. Leave branches
  checked out in other worktrees alone.

## The user's data

The installed build keeps its catalog at `~/Library/Application Support/prism/photo-index.db`,
and the development build at `~/Library/Application Support/Prism Development/photo-index.db`.
The installed one is what the user's app actually uses; the development one may be stale.

- Never open either catalog for writing. To look at one, copy it read-only into a scratch
  folder with `sqlite3 'file:<catalog>?mode=ro' '.backup <scratch>/copy.db'`, and delete the
  copy afterwards.
- Only ever read the user's photo libraries and the shares they're on: never write to them,
  and never mount or unmount a share.

## Performance

Prism has to stay fast on a library of about 2M photos and videos in 40,000 or more nested
folders on an SMB share, with a catalog of about 800 MB. The whole-library filmstrip scrolls all
of them. The window shows what the catalog already knows, at once, and the
catalog catches up with the share in the background. Nothing the user looks at waits for the
share, and background work never makes the app feel slow.

Weigh every design, fix and review at that size, and say how an option scales:

- Keep memory bounded by what is mounted or on screen (the viewport plus overscan), plus fixed
  caps, never by the library's size or by how far the user has scrolled.
- Never do per-entry work or send per-entry messages that grow with the library.
- Never assume a budget is met: measure it on a read-only copy of the installed build's
  catalog, headless, and note the load average.

How the app is built to meet that:

1. The window reads only the catalog; no window call touches the share.
2. A row carries everything its tile needs, so a tile never makes a second call.
3. Reads never queue behind writes or disk work. The catalog has a reader connection for the
   window and a writer for the indexer, and every query names its index, which a query-plan
   test checks.
4. One scheduler orders all disk work by what the user sees: what's on screen, then what's just
   ahead, then the background.
5. The window doesn't patch lists. The catalog raises a version, and the window reads its range
   again.
6. Main serves thumbnail bytes from the cache by key, with no worker or catalog call.

Time budgets:

| Step                                    | Budget                                                        |
| --------------------------------------- | ------------------------------------------------------------- |
| Window to main to worker                | under 5 ms                                                    |
| A catalog read                          | 1–2 ms                                                        |
| A thumbnail request                     | about 2 ms; a miss returns at once                            |
| Opening or closing a folder in the tree | one frame, with no call                                       |
| A version change to the repaint         | one frame after the read; at most one push per view per frame |

Design decisions:

- **Folder tree:** it must be instant.
- **Folder covers:** stored on the folder's row.
- **Edits:** show at once and revert if they fail.
- **Thumbnails ahead of the scroll:** made only in views under 1,000 items.
- **Thumbnail cache:** limited to 5 GB.
- **Launch check:** reads only the folders whose times moved. A full read runs weekly, picks up
  where it stopped after a quit, and can be started from File › Read Library Again.
- **Photo details:** read 12 at a time while Prism is focused, 4 otherwise.
- **Background re-sorting:** at most about 10–15% of a core. A rebuild needed only because
  details came in waits 8× the view's last build time, between 0.5 and 30 s. A view whose sort
  and filters read no details only recounts, on the views' thread. The user's own sort and
  filter changes stay quick.
- **No flicker:** tiles and the selection keep their identity when a view is sorted again.
- **Background work is visible:** the activity panel shows each kind of work with its progress
  and when it will be done. Work with no end in sight is a bug.
- **Offline share:**
  - navigation keeps working with the share offline: the tree, folders, views, search and
    cached thumbnails all come from the catalog and caches, and no navigation ever waits for the
    share or fails because it's gone. Only what truly needs the files, such as an original that
    isn't cached, says the share is offline;
  - catalog data is never lost to it, and a removal needs a fresh check that the share is
    online;
  - work pauses with no retry storms, and a look that takes over 5 s counts as offline;
  - photos that can't be read are recorded as done, but ones that failed because the share was
    offline are tried again.

What an SMB share costs, as measured on such a library:

- A JPG read takes about 475 ms, four at a time.
- File lookups run at about 4.3k a second, so reading every folder takes about 7.5 minutes.
- The share stalls for about 2 s every minute or two.
- A share that is mounted but not answering takes about a minute to fail each look.
- Names that end in a dot or a space can't be looked up.
- A local disk is far faster, so numbers that depend on the share need the real share.

Problems already hit, to watch for:

- A query that doesn't name its index scans the whole library: 229 ms a call against 0.4 ms.
- Change checks that marked views stale when nothing had changed.
- The tree being read again thousands of times during a walk.
- Tree refreshes blocking the reader thread.
- Counts on the reader thread that stall the window's reads.
- Full reads of the share on every launch.
- Chromium caps an element at 16,777,216 px, so very long lists need their own scroll scheme.

## Leading other agents

When you lead a feature, you plan it, split it into pieces, brief an agent for each piece and
review its PR. Plans live in Claude Docs, not in `.context/`, which worktree cleanup can wipe.

- Write every decision the user makes into the plan, with its date, in the same turn. Keep its
  Progress section current as PRs open, fail, go green and merge. Keep the design in one or two
  diagrams, updated whenever a merged change moves a thread, store, message or flow.
- Each PR has one owner: the agent that wrote it. Send its conflicts, CI failures and review
  findings back to that agent. Only start a new one if the owner can't be resumed, and never
  give one job to two agents.
- When CI fails or a PR conflicts, tell the owner which PR and job. Leave finding the cause to
  them.
- Put the rules above in every brief: data safety, headless runs, cleanup, simple code and the
  performance requirements.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": true` in the root `turbo.json` or `turbo.jsonc` to opt in; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
