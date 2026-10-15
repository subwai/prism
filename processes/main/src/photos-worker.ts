import { type BackendRequest, type BackendResponse, createPhotoBackend } from '#photos/backend';
import { errorMessage, PhotoLibrary } from '#photos/library';
import path from 'node:path';

const CACHE_ARGUMENT = 3,
  ROOT_ARGUMENT = 2,
  port = process.parentPort,
  root = process.argv[ROOT_ARGUMENT],
  cacheDirectory = process.argv[CACHE_ARGUMENT];

if (!port || !root || !cacheDirectory) {
  throw new Error('Launch the photo worker with a folder and cache directory.');
}
const library = await PhotoLibrary.open(root),
  backend = createPhotoBackend(library, cacheDirectory);

async function respond(request: BackendRequest, parent: NonNullable<typeof port>): Promise<void> {
  try {
    const value: unknown = await Reflect.apply(backend[request.method], backend, request.args);
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
    parent.postMessage({ id: request.id, value } satisfies BackendResponse);
  } catch (error) {
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
    parent.postMessage({ error: errorMessage(error), id: request.id } satisfies BackendResponse);
  }
}

port.on('message', (event) => {
  respond(event.data as BackendRequest, port);
});
port.postMessage({ ready: { id: '.', name: path.basename(library.root) || library.root } });
