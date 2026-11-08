import {
  createPhotoBackend,
  type FrameRequest,
  type FrameResponse,
  type PhotoBackend,
} from '#photos/backend';
import { Catalog } from '#photos/catalog/client';
import { prepareIndex } from '#photos/catalog/photo-index';
import { errorMessage } from '#photos/errors';
import { PhotoLibrary } from '#photos/library';
import { folderLocation } from '#photos/location';
import type { FrameReader } from '#photos/thumbnails';
import { type PathChanges, watchFolder } from '#photos/watcher';
import {
  type FolderChanges,
  type PhotoRoot,
  WORKER_METHODS,
  type WorkerEvent,
  type WorkerRequest,
  type WorkerResponse,
} from '@prism/shared';
import type { MessagePortMain } from 'electron';
import path from 'node:path';

const CACHE_ARGUMENT = 3,
  INDEX_ARGUMENT = 4,
  ROOT_ARGUMENT = 2,
  port = process.parentPort,
  root = process.argv[ROOT_ARGUMENT],
  cacheDirectory = process.argv[CACHE_ARGUMENT],
  indexFile = process.argv[INDEX_ARGUMENT],
  frames = new Map<number, PromiseWithResolvers<Uint8Array>>();
let frameSequence = 0;

if (!port || !root || !cacheDirectory || !indexFile) {
  throw new Error('Launch the photo worker with a folder, cache directory and index file.');
}

// Quick Look and the Windows shell render stills of videos and HEIF photos, but only the main
// process can reach them.
const readFrame: FrameReader = (source, { width, height }, signal) => {
  signal.throwIfAborted();
  const id = frameSequence;
  frameSequence += 1;
  const request = Promise.withResolvers<Uint8Array>();
  frames.set(id, request);
  signal.addEventListener('abort', () => request.reject(signal.reason), { once: true });
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
  port.postMessage({ frame: { height, id, source, width } } satisfies FrameRequest);
  return request.promise.finally(() => frames.delete(id));
};

const library = await PhotoLibrary.open(root, prepareIndex(indexFile), Catalog.threaded),
  backend = createPhotoBackend(
    library,
    cacheDirectory,
    process.platform === 'darwin' || process.platform === 'win32' ? readFrame : undefined,
  );

/** Window ports, which hear about changes and may call only the window's methods. */
const windows = new Set<MessagePortMain>();

/** Tells every window what happened, unasked. */
function broadcast(event: WorkerEvent) {
  for (const window of windows) {
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
    window.postMessage(event);
  }
}
library.views.onView((view) => broadcast({ view }));

/** Answers `request` on `target`; `allowed` limits which methods it may call. */
async function respond(
  request: WorkerRequest,
  target: { postMessage: (message: WorkerResponse) => void },
  allowed?: ReadonlySet<string>,
): Promise<void> {
  try {
    if (allowed && !allowed.has(request.method)) {
      throw new Error(`The window cannot call ${request.method}.`);
    }
    const method = backend[request.method as keyof PhotoBackend];
    const value: unknown = await Reflect.apply(method, backend, request.args);
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
    target.postMessage({ id: request.id, value });
  } catch (error) {
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
    target.postMessage({ error: errorMessage(error), id: request.id });
  }
}

/** The window calls this worker directly over `window`, without the main process. */
function connect(window: MessagePortMain) {
  windows.add(window);
  window.on('message', (event) => respond(event.data as WorkerRequest, window, WORKER_METHODS));
  window.on('close', () => windows.delete(window));
  window.start();
}

port.on('message', (event) => {
  const message = event.data as WorkerRequest | FrameResponse | { connect: true };
  if ('connect' in message) {
    const [window] = event.ports;
    if (window) {
      connect(window);
    }
  } else if ('frame' in message) {
    const request = frames.get(message.frame.id);
    if ('image' in message.frame) {
      request?.resolve(message.frame.image);
    } else {
      request?.reject(new Error(message.frame.error));
    }
  } else {
    respond(message, port);
  }
});
// eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
port.postMessage({
  ready: {
    id: '.',
    location: await folderLocation(library.root),
    name: path.basename(library.root) || library.root,
  } satisfies PhotoRoot,
});
async function report({ changed, everything }: PathChanges) {
  if (everything) {
    library.forget();
  }
  const changes: FolderChanges = {
    changed: everything ? [] : await library.describeChanges(changed),
    everything,
  };
  if (changes.everything || changes.changed.length > 0) {
    broadcast({ changes });
  }
}

// One batch at a time, so changes arrive in the order they happened.
let reporting: Promise<unknown> = Promise.resolve();
function queue(changes: PathChanges) {
  // A batch that fails to describe is lost, but must not stop the ones after it.
  reporting = reporting.then(() => report(changes)).catch(() => null);
}
watchFolder(library.root, library.controller.signal, queue);
