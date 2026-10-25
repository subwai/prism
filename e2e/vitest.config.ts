import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  test: {
    // Shows the snapshots `trace.ts` records. Browser mode itself stays off.
    browser: { traceView: { enabled: true } },
    // Every test launches the app, so run files one at a time.
    fileParallelism: false,
    globalSetup: ['support/global-setup.ts'],
    hookTimeout: 60_000,
    // The app stays hidden unless the run passes `--mode headed`, to watch it.
    provide: { headed: mode === 'headed' },
    testTimeout: 30_000
  }
}));
