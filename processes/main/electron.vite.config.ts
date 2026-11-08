import { defineConfig, type MainViteConfig } from 'electron-vite';
import path from 'node:path';

export function createMainConfig(root: string): MainViteConfig {
  return {
    build: {
      emptyOutDir: true,
      externalizeDeps: false,
      lib: {
        entry: {
          // The catalog of a folder's photos, on a thread of the folder's worker.
          'catalog-thread': path.join(root, 'src/catalog-thread.ts'),
          index: path.join(root, 'src/index.ts'),
          'photos-worker': path.join(root, 'src/photos-worker.ts'),
        },
      },
      outDir: path.resolve(root, '../../out/main'),
      // Both load native addons from their own folders, so they stay where they are.
      rolldownOptions: { external: ['sharp', '@prism/windows-imaging'] },
    },
    root,
  };
}

export default defineConfig({ main: createMainConfig(import.meta.dirname) });
