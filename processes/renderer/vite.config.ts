import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { type ConfigEnv, defineConfig, type UserConfig } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';

function rendererConfig({ command }: ConfigEnv): UserConfig {
  return {
    // Assets stay files rather than `data:` URLs, which the page's CSP does not allow for images.
    build: { assetsInlineLimit: 0, emptyOutDir: true },
    plugins: [
      tailwindcss(),
      // Only for React Compiler: React Router's plugin applies Fast Refresh itself.
      react({ compiler: true, refreshExclude: /.*/u }),
      // Answers DevTools' workspace request, which React Router would otherwise log as a missing
      // route, and maps the whole repo so the shared packages' sources are editable there too.
      devtoolsJson({ projectRoot: path.resolve(import.meta.dirname, '../..') }),
      reactRouter(),
    ],
    root: import.meta.dirname,
    // The temporary server bundle runs outside this workspace while generating SPA HTML.
    ssr: command === 'build' ? { noExternal: true } : {},
  };
}

export default defineConfig(rendererConfig);
