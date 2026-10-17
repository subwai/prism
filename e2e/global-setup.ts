import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** A folder of generated photos the tests open. */
    photos: string;
    /** Whether the Vitest UI is open to show the traces `trace.ts` records. */
    traceView: boolean;
  }
}

/** Large enough that fitting them shrinks them, plus one smaller than any window. */
export const PHOTOS = [
  { color: '#2a5d9f', height: 3000, name: 'landscape.jpg', width: 4000 },
  { color: '#8a6d2f', height: 3600, name: 'portrait.jpg', width: 2400 },
  { color: '#3f8a4f', height: 400, name: 'small.jpg', width: 600 }
];

export const VIDEO = 'clip.mp4',
  WEBM_VIDEO = 'clip.webm';

export default async function setup(project: TestProject) {
  if (!existsSync(path.resolve(import.meta.dirname, '../out/main/index.js'))) {
    throw new Error('Build the app before running end-to-end tests: pnpm turbo build');
  }
  const folder = await mkdtemp(path.join(os.tmpdir(), 'e2e-photos-'));
  await Promise.all([
    ...PHOTOS.map(({ name, width, height, color }) =>
      sharp({ create: { background: color, channels: 3, height, width } }).toFile(
        path.join(folder, name)
      )
    ),
    // Test patterns, silent: twelve seconds of H.264, and six of VP9, which the system's
    // thumbnailer cannot read. Nothing in setup can encode video.
    ...[VIDEO, WEBM_VIDEO].map((name) =>
      copyFile(path.resolve(import.meta.dirname, 'fixtures', name), path.join(folder, name))
    )
  ]);
  project.provide('photos', folder);
  // Recording slows the app down, so only record when a trace view can show it.
  project.provide('traceView', project.vitest.config.ui);
  return async () => {
    await rm(folder, { force: true, recursive: true });
  };
}
