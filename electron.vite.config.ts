import { createMainConfig } from './processes/main/electron.vite.config.ts';
import { createPreloadConfig } from './processes/preload/electron.vite.config.ts';
import { defineConfig } from 'electron-vite';
import path from 'node:path';

export default defineConfig({
  main: createMainConfig(path.join(import.meta.dirname, 'processes/main')),
  preload: createPreloadConfig(path.join(import.meta.dirname, 'processes/preload')),
});
