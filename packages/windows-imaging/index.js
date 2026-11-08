import { createRequire } from 'node:module';

/** The addon `scripts/build.ts` builds, which exists on Windows only. */
let addon, loadError;
if (process.platform === 'win32') {
  try {
    addon = createRequire(import.meta.url)(`./windows-imaging.win32-${process.arch}-msvc.node`);
  } catch (error) {
    loadError = error;
  }
}

export function convertToJpeg(path, quality, signal) {
  if (!addon) {
    return Promise.reject(
      new Error('Windows imaging is built for Windows only.', { cause: loadError }),
    );
  }
  return addon.convertToJpeg(path, quality, signal);
}
