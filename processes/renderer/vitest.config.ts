import { defineTestConfig } from '@prism/vitest-config';
import tailwindcss from '@tailwindcss/vite';

// Takes the place of `vite.config.ts` in tests: they import modules directly, and the React
// Router plugin's dev tooling would keep Vitest from exiting.
export default defineTestConfig({ component: { plugins: [tailwindcss()] } });
