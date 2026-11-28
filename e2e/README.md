# @prism/e2e

End-to-end tests: they build Prism, launch the real app with Playwright's Electron driver, and
use it as a person would, on a folder of test photos.

## When to write one

Rarely. An end-to-end test is slow and launches the whole app, so it is for what only the real
app shows: the main process, native windows and menus, real files on disk, and flows across
several screens. Anything a window component shows on its own gets a component test instead,
and logic a unit test. AGENTS.md's [Tests](../AGENTS.md#tests) says how to choose; before adding
a test here, say in its pull request why a component test can't show the behaviour.

## Layout

| Where                    | What it holds                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/`                 | The tests, a file per feature.                                                                                                                                   |
| `tests/__screenshots__/` | The design system's screenshots, one set per platform.                                                                                                           |
| `support/`               | What the tests share: the fixtures that launch, reset and relaunch the app, the folder of test photos made once per run, and helpers for one kind of check each. |

A failed test keeps what shows how it failed in `test-results/`: a Playwright trace of each app,
the window as it ended, and the app's logs.

## Rules

- **Headless.** The app keeps its window hidden, so a run never takes over the screen. Only CI
  passes `--mode headed`, under Xvfb on Linux, for the full-screen tests.
- **Every app a test launches closes,** through the fixtures' cleanup. No `e2e-profile` process
  should outlive a run.
- **Each app has a profile of its own,** never the developer's or the installed app's data.
- **Tests that go full screen** need the display to themselves, so list their file in `ALONE` in
  `vitest.config.ts`, which runs those one at a time after the rest.
- **Wait for what the window shows,** with `expect.poll` or a locator, not for a fixed time,
  which is either slow or flaky. A fixed wait only checks that something stays as it is.

## Running

`pnpm turbo test -F @prism/e2e` builds the app and runs every test. When other work shares the
machine, run them gently from this folder:

```sh
caffeinate -i nice -n 10 pnpm exec vitest run --no-file-parallelism
```

A test that fails under heavy load or after the Mac slept may not be a bug: check `uptime` and
`pmset -g log` first. See [docs/development.md](../docs/development.md) for traces and debug
logs.
