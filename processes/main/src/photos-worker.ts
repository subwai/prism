import { WorkerBackend } from '#photos/worker/backend';
import { readFrame, receiveFrame } from '#photos/worker/frames';
import { PhotoLibrary } from '#photos/worker/library';
import { folderLocation } from '#photos/worker/location';
import { reportChanges } from '#photos/worker/report-changes';
import { watchFolder } from '#photos/worker/watcher';
import { Catalog, prepareIndex, prepareRatings } from '@prism/catalog';
import {
  debug,
  type FrameResponse,
  type PhotoRoot,
  serve,
  WORKER_METHODS,
  type WorkerEvent,
  type WorkerRequest,
  type WorkerResponse,
} from '@prism/shared';
import type { MessagePortMain } from 'electron';
import path from 'node:path';

const CACHE_ARGUMENT = 3,
  INDEX_ARGUMENT = 4,
  RATINGS_ARGUMENT = 5,
  ROOT_ARGUMENT = 2,
  port = process.parentPort,
  root = process.argv[ROOT_ARGUMENT],
  cacheDirectory = process.argv[CACHE_ARGUMENT],
  indexFile = process.argv[INDEX_ARGUMENT],
  ratingsFile = process.argv[RATINGS_ARGUMENT],
  logViews = debug('worker:views');

if (!port || !root || !cacheDirectory || !indexFile || !ratingsFile) {
  throw new Error(
    'Launch the photo worker with a folder, cache directory, index file and ratings file.',
  );
}

const library = await PhotoLibrary.open(
    root,
    { index: prepareIndex(indexFile), ratings: prepareRatings(ratingsFile) },
    Catalog.threaded(path.join(import.meta.dirname, 'catalog-thread.js')),
  ),
  backend = new WorkerBackend(
    library,
    cacheDirectory,
    // Quick Look and the Windows shell render stills of videos and HEIF photos, but only the
    // main process can reach them.
    process.platform === 'darwin' || process.platform === 'win32'
      ? (...request) => readFrame(port, ...request)
      : undefined,
  );

/** Window ports, which hear about changes and may call only the window's methods. */
const windows = new Set<MessagePortMain>();

/** Tells every window what happened, unasked: an update of the library, or stale entries. */
function broadcast(event: WorkerEvent) {
  for (const view of 'views' in event ? event.views : []) {
    logViews(
      '%s at version %d: %d entries%s',
      view.viewId,
      view.version,
      view.count,
      view.loading ? ', loading' : '',
    );
  }
  for (const window of windows) {
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
    window.postMessage(event);
  }
}
library.views.onView((view) => broadcast({ changes: null, views: [view] }));

/** Answers `request` on `target`; `allowed` limits which methods it may call. */
async function respond(
  request: WorkerRequest,
  target: { postMessage: (message: WorkerResponse) => void },
  allowed?: ReadonlySet<string>,
): Promise<void> {
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
  target.postMessage(await serve(backend, request, allowed));
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
    receiveFrame(message);
  } else {
    respond(message, port);
  }
});
// The main process adds the session, which it names.
// eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
port.postMessage({
  ready: {
    id: '.',
    location: await folderLocation(library.root),
    name: path.basename(library.root) || library.root,
  } satisfies Omit<PhotoRoot, 'session'>,
});
watchFolder(library.root, library.signal, (changes) => reportChanges(library, broadcast, changes));
