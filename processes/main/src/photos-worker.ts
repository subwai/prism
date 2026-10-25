import {
  type BackendRequest,
  type BackendResponse,
  createPhotoBackend,
  type FrameRequest,
  type FrameResponse
} from '#photos/backend';
import { errorMessage } from '#photos/errors';
import { PhotoLibrary } from '#photos/library';
import type { FrameReader } from '#photos/thumbnails';
import { type PathChanges, watchFolder } from '#photos/watcher';
import type { FolderChanges } from '@prism/shared';
import path from 'node:path';

const CACHE_ARGUMENT = 3,
  ROOT_ARGUMENT = 2,
  port = process.parentPort,
  root = process.argv[ROOT_ARGUMENT],
  cacheDirectory = process.argv[CACHE_ARGUMENT],
  frames = new Map<number, PromiseWithResolvers<Uint8Array>>();
let frameSequence = 0;

if (!port || !root || !cacheDirectory) {
  throw new Error('Launch the photo worker with a folder and cache directory.');
}

// Quick Look and the Windows shell render video stills, but only the main process can reach them.
const readFrame: FrameReader = (source, edge, signal) => {
  signal.throwIfAborted();
  const id = frameSequence;
  frameSequence += 1;
  const request = Promise.withResolvers<Uint8Array>();
  frames.set(id, request);
  signal.addEventListener('abort', () => request.reject(signal.reason), { once: true });
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
  port.postMessage({ frame: { edge, id, source } } satisfies FrameRequest);
  return request.promise.finally(() => frames.delete(id));
};

const library = await PhotoLibrary.open(root),
  backend = createPhotoBackend(
    library,
    cacheDirectory,
    process.platform === 'darwin' || process.platform === 'win32' ? readFrame : undefined
  );

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
  const message = event.data as BackendRequest | FrameResponse;
  if ('frame' in message) {
    const request = frames.get(message.frame.id);
    if ('image' in message.frame) {
      request?.resolve(message.frame.image);
    } else {
      request?.reject(new Error(message.frame.error));
    }
    return;
  }
  respond(message, port);
});
port.postMessage({ ready: { id: '.', name: path.basename(library.root) || library.root } });
async function report({ changed, everything }: PathChanges) {
  if (everything) {
    library.forget();
  }
  const changes: FolderChanges = {
    changed: everything ? [] : await library.describeChanges(changed),
    everything
  };
  if (changes.everything || changes.changed.length > 0) {
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
    port.postMessage({ changes } satisfies { changes: FolderChanges });
  }
}

// One batch at a time, so changes arrive in the order they happened.
let reporting: Promise<unknown> = Promise.resolve();
watchFolder(library.root, library.controller.signal, (changes) => {
  // A batch that fails to describe is lost, but must not stop the ones after it.
  reporting = reporting.then(() => report(changes)).catch(() => null);
});
