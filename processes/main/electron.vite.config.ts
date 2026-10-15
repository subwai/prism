import { defineConfig, type MainViteConfig } from 'electron-vite';
import path from 'node:path';

export function createMainConfig(root: string): MainViteConfig {
  return {
    build: {
      emptyOutDir: true,
      externalizeDeps: false,
      lib: { entry: path.join(root, 'src/index.ts') },
      outDir: path.resolve(root, '../../out/main')
    },
    root
  };
}

export default defineConfig({ main: createMainConfig(import.meta.dirname) });
