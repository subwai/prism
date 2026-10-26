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
 * `@prism/vitest-config#browsers`, which installs it.
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
          enabled: true,
          headless: true,
          instances: [{ browser: 'chromium' }],
          provider: playwright(),
        },
        include: ['src/**/__tests__/*.test.tsx'],
        name: 'component',
      },
    });
  }
  return defineConfig({ test: { projects } });
}
