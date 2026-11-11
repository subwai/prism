import { commands } from './commands.ts';
import { playwright } from '@vitest/browser-playwright';
import {
  defineConfig,
  type TestProjectInlineConfiguration,
  type ViteUserConfig,
} from 'vitest/config';

interface Suites {
  /** Adds the component suite, with the Vite plugins its components need, such as Tailwind. */
  component?: { plugins?: ViteUserConfig['plugins'] };
}

/**
 * A package's test suites, in its `__tests__` directories: unit tests, `*.test.ts`, in Node,
 * and with `component`, component tests, `*.test.tsx`, which render in Chromium for the layout,
 * observers and scrolling that a simulated DOM lacks. Chromium runs headless, so a run never
 * takes over the screen; a package with component tests has its `test` task depend on
 * `@prism/vitest-config#browsers`, which installs it. The component suite also has the
 * commands in `./browser.ts`, such as `mouse`.
 */
export function defineTestConfig({ component }: Suites = {}) {
  const projects: TestProjectInlineConfiguration[] = [
    { test: { include: ['src/**/__tests__/*.test.ts'], name: 'unit' } },
  ];
  if (component) {
    projects.push({
      plugins: component.plugins,
      test: {
        browser: {
          commands,
          // Saves serving dependencies' source maps to every page. Errors from dependencies are
          // still mapped to their source; only stepping into them in the devtools is not.
          dependencySourcemaps: false,
          enabled: true,
          headless: true,
          instances: [{ browser: 'chromium' }],
          provider: playwright(),
        },
        // How long `expect.element` and `expect.poll` wait, which they only use up when a check
        // fails or the page is slow, as a file's first test is on a busy CI runner while it
        // paints the fake folder's photos. Playwright's own default, rather than Vitest's 1 s.
        expect: { poll: { timeout: 5000 } },
        include: ['src/**/__tests__/*.test.tsx'],
        name: 'component',
      },
    });
  }
  return defineConfig({ test: { projects } });
}
