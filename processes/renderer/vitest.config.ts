import { defineConfig } from 'vitest/config';

// Takes the place of `vite.config.ts` in tests: they import modules directly, and the React
// Router plugin's dev tooling would keep Vitest from exiting.
export default defineConfig({});
