# @prism/vitest-config

The Vitest setup every package's tests share. A package's `vitest.config.ts` calls
`defineTestConfig()`, and the tests in its `__tests__` folders run as one or two suites:

- **unit tests**, `*.test.ts`, in Node;
- **component tests**, `*.test.tsx`, in headless Chromium through Vitest Browser Mode, when the
  config passes `component`. They get the commands in `@prism/vitest-config/browser` to drive
  the page as a person would.

`src/` holds the suites and the browser commands, and a Vite plugin that keeps Vitest's cache
from going stale for modules that use `import.meta.glob`. A package with component tests has its `test` task depend on this package's
`browsers` task, which installs Chromium. AGENTS.md's [Tests](../../AGENTS.md#tests) says which
kind of test to write.
