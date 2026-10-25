import { defineConfig, type PreloadViteConfig } from 'electron-vite';
import path from 'node:path';

export function createPreloadConfig(root: string): PreloadViteConfig {
  return {
    build: {
      emptyOutDir: true,
      externalizeDeps: false,
      lib: {
        entry: path.join(root, 'src/index.ts'),
        fileName: () => 'index.cjs',
        // Sandboxed preloads need a single CommonJS bundle.
        formats: ['cjs'],
      },
      outDir: path.resolve(root, '../../out/preload'),
    },
    root,
  };
}

export default defineConfig({ preload: createPreloadConfig(import.meta.dirname) });
