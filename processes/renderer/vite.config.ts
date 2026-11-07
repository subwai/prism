import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type ConfigEnv, defineConfig, type UserConfig } from 'vite';

function rendererConfig({ command }: ConfigEnv): UserConfig {
  return {
    // Assets stay files rather than `data:` URLs, which the page's CSP does not allow for images.
    build: { assetsInlineLimit: 0, emptyOutDir: true },
    plugins: [
      tailwindcss(),
      // Only for React Compiler: React Router's plugin applies Fast Refresh itself.
      react({ compiler: true, refreshExclude: /.*/u }),
      reactRouter(),
    ],
    root: import.meta.dirname,
    // The temporary server bundle runs outside this workspace while generating SPA HTML.
    ssr: command === 'build' ? { noExternal: true } : {},
  };
}

export default defineConfig(rendererConfig);
