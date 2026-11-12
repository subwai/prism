import { createRequire } from 'node:module';

/** The addon `scripts/build.ts` builds for this system. */
const FILES = {
  darwin: 'trash.darwin-universal.node',
  linux: `trash.linux-${process.arch}-gnu.node`,
  win32: `trash.win32-${process.arch}-msvc.node`,
};

let addon;
let loadError;
try {
  addon = createRequire(import.meta.url)(`./${FILES[process.platform]}`);
} catch (error) {
  loadError = error;
}

function unbuilt() {
  return Promise.reject(
    new Error('The Trash addon is not built for this system.', { cause: loadError }),
  );
}

export function trashItem(path) {
  return addon ? addon.trashItem(path) : unbuilt();
}

export function restoreItem(landed, to) {
  return addon ? addon.restoreItem(landed, to) : unbuilt();
}
