import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { type ConfigEnv, defineConfig, type UserConfig } from 'vite';

function rendererConfig({ command }: ConfigEnv): UserConfig {
  return {
    build: { emptyOutDir: true },
    plugins: [tailwindcss(), reactRouter()],
    root: import.meta.dirname,
    // The temporary server bundle runs outside this workspace while generating SPA HTML.
    ssr: command === 'build' ? { noExternal: true } : {}
  };
}

export default defineConfig(rendererConfig);
