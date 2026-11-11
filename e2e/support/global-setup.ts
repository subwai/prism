import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The Electron binary every test file launches. */
    electronPath: string;
    /** Whether the app's window shows, which the run asks for with `--mode headed`. */
    headed: boolean;
    /** A folder of generated photos the tests open. */
    photos: string;
    /** Whether screenshots may be recorded: all of them (`-u`), only missing ones, or none. */
    screenshots: 'all' | 'new' | 'none';
    /** Whether the Vitest UI is open to show the traces `trace.ts` records. */
    traceView: boolean;
  }
}

/**
 * Photos of one colour, 4000×3000 and 2400×3600, large enough that fitting them shrinks them,
 * and 600×400, smaller than any window.
 */
const PHOTOS = ['landscape.jpg', 'portrait.jpg', 'small.jpg'];

export const VIDEO = 'clip.mp4',
  WEBM_VIDEO = 'clip.webm';

export default async function setup(project: TestProject) {
  if (!existsSync(path.resolve(import.meta.dirname, '../../out/main/index.js'))) {
    throw new Error('Build the app before running end-to-end tests: pnpm turbo build');
  }
  // Electron downloads its binary the first time something requires it, rather than on
  // install, so a fresh checkout has none. Left to Playwright, every test file's worker would
  // require it at once and unzip over each other, leaving a binary that is there but broken
  // and that nothing downloads again. Required here, it downloads once, before any worker.
  const require = createRequire(import.meta.url);
  project.provide('electronPath', require('electron') as string);
  const folder = await mkdtemp(path.join(os.tmpdir(), 'e2e-photos-'));
  // The photos, and test patterns, silent: twelve seconds of H.264, and six of VP9, which the
  // system's thumbnailer cannot read. The component tests show the same files.
  await Promise.all(
    [...PHOTOS, VIDEO, WEBM_VIDEO].map((name) =>
      copyFile(require.resolve(`@prism/test-media/${name}`), path.join(folder, name)),
    ),
  );
  project.provide('photos', folder);
  project.provide('screenshots', project.vitest.config.snapshotOptions.updateSnapshot);
  // Recording slows the app down, so only record when a trace view can show it.
  project.provide('traceView', project.vitest.config.ui);
  return async () => {
    await rm(folder, { force: true, recursive: true });
  };
}
