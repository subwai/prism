import { defineTestConfig } from '@prism/vitest-config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

// Takes the place of `vite.config.ts` in tests: they import modules directly, and the React
// Router plugin's dev tooling would keep Vitest from exiting. Components are compiled as the
// app's are, so tests cover what React Compiler makes of them.
export default defineTestConfig({
  component: { plugins: [tailwindcss(), react({ compiler: true })] },
});
