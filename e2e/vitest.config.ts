import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Files that need the display to themselves: their tests go full screen, which another app's
 * window opening or going full screen over theirs would interrupt.
 */
const ALONE = ['tests/full-screen.test.ts'];

export default defineConfig(({ mode }) => ({
  test: {
    // Shows the snapshots `trace.ts` records. Browser mode itself stays off.
    browser: { traceView: { enabled: true } },
    globalSetup: ['support/global-setup.ts'],
    hookTimeout: 60_000,
    // A window opening or going full screen over another app's takes its hover and drags, so
    // those files run one at a time, after the rest. That takes `fileParallelism` rather than
    // `maxWorkers`, which the command line's `--maxWorkers` overrides.
    projects: [
      { test: { exclude: [...configDefaults.exclude, ...ALONE], name: 'app' } },
      {
        test: {
          fileParallelism: false,
          include: ALONE,
          name: 'alone',
          sequence: { groupOrder: 1 },
        },
      },
    ],
    // The app stays hidden unless the run passes `--mode headed`, to watch it.
    provide: { headed: mode === 'headed' },
    testTimeout: 30_000,
  },
}));
