import { defineConfig } from 'vitest/config';

// Runs every package's tests, end-to-end tests included, as one Vitest run or UI.
export default defineConfig({
  test: { projects: ['packages/*', 'processes/*', 'e2e'] }
});
