import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Shows the snapshots `trace.ts` records. Browser mode itself stays off.
    browser: { traceView: { enabled: true } },
    // Every test launches the app, so run files one at a time.
    fileParallelism: false,
    globalSetup: ['global-setup.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000
  }
});
