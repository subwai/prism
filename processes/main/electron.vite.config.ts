import { defineConfig, type MainViteConfig } from 'electron-vite';
import path from 'node:path';

export function createMainConfig(root: string): MainViteConfig {
  return {
    build: {
      emptyOutDir: true,
      externalizeDeps: false,
      lib: {
        entry: {
          index: path.join(root, 'src/index.ts'),
          'photos-worker': path.join(root, 'src/photos-worker.ts')
        }
      },
      outDir: path.resolve(root, '../../out/main'),
      rolldownOptions: { external: ['sharp'] }
    },
    root
  };
}

export default defineConfig({ main: createMainConfig(import.meta.dirname) });
