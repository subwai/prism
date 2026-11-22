import type { WorkerFocus, WorkerMessage } from '#photos/main/worker-start';
import { activityReports } from '#photos/worker/activity';
import { WorkerBackend } from '#photos/worker/backend';
import { reportChanges } from '#photos/worker/changes/report-changes';
import { watchFolder } from '#photos/worker/changes/watcher';
import { PhotoLibrary } from '#photos/worker/library';
import { folderLocation } from '#photos/worker/location';
import { readFrame, receiveFrame } from '#photos/worker/on-screen/frames';
import { Catalog, prepareIndex, prepareRatings } from '@prism/catalog';
import {
  debug,
  type FrameResponse,
  serve,
  WINDOW_METHODS,
  type WorkerEvent,
  type WorkerRequest,
  type WorkerResponse,
} from '@prism/shared';
import type { MessagePortMain } from 'electron';
import path from 'node:path';

const CACHE_ARGUMENT = 3;
const INDEX_ARGUMENT = 4;
const RATINGS_ARGUMENT = 5;
const ROOT_ARGUMENT = 2;
const port = process.parentPort;
const root = process.argv[ROOT_ARGUMENT];
const cacheDirectory = process.argv[CACHE_ARGUMENT];
const indexFile = process.argv[INDEX_ARGUMENT];
const ratingsFile = process.argv[RATINGS_ARGUMENT];
const logViews = debug('worker:views');
const logActivity = debug('worker:activity');

if (!port || !root || !cacheDirectory || !indexFile || !ratingsFile) {
  throw new Error(
    'Launch the photo worker with a folder, cache directory, index file and ratings file.',
  );
}

// Upgrading a large catalog takes a minute or so, which the main process waits out and the
// window says.
const index = prepareIndex(indexFile, () => {
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
  port.postMessage({ upgrading: true } satisfies WorkerMessage);
});
const library = PhotoLibrary.open(
  root,
  { index, ratings: prepareRatings(ratingsFile) },
  Catalog.threaded(path.join(import.meta.dirname, 'catalog-thread.js')),
);
const backend = new WorkerBackend(
  library,
  cacheDirectory,
  // Quick Look and the Windows shell render stills of videos and HEIF photos, but only the
  // main process can reach them.
  process.platform === 'darwin' || process.platform === 'win32'
    ? (...request) => readFrame(port, ...request)
    : undefined,
  (event) => broadcast(event),
);

/** Window ports. They are sent every event, and may call only the window's methods. */
const windows = new Set<MessagePortMain>();

/** Sends every window an event it did not ask for; see `WorkerEvent`. */
function broadcast(event: WorkerEvent) {
  for (const view of event.kind === 'update' ? event.update.views : []) {
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
library.views.onNewVersion((view) =>
  broadcast({ kind: 'update', update: { changes: null, views: [view] } }),
);

const activity = activityReports(
  () => library.activity.current(),
  (now) => {
    logActivity('%o', now);
    broadcast({ activity: now, kind: 'activity' });
  },
);
library.activity.onChange(activity.changed);

// Folders whose subfolders changed, and folders whose tiles changed, are sent together, at most
// this often, so a library read for the first time sends its thousands of folders in a few
// batches.
const FOLDER_CHANGES_MS = 250;
const foldersChanged = new Set<string>();
const tilesChanged = new Set<string>();
function sendFolderChangesSoon(pending: Set<string>, folderIds: string[]) {
  if (folderIds.length === 0) {
    return;
  }
  if (foldersChanged.size === 0 && tilesChanged.size === 0) {
    setTimeout(() => {
      broadcast({
        kind: 'update',
        update: {
          changes: null,
          folders: [...foldersChanged],
          tiles: [...tilesChanged],
          views: [],
        },
      });
      foldersChanged.clear();
      tilesChanged.clear();
    }, FOLDER_CHANGES_MS);
  }
  for (const folderId of folderIds) {
    pending.add(folderId);
  }
}
library.onFoldersChanged(({ folders, tiles }) => {
  sendFolderChangesSoon(foldersChanged, folders);
  sendFolderChangesSoon(tilesChanged, tiles);
});

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
  // A window is only sent changes, so it is sent what is under way when it connects.
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
  window.postMessage({ activity: activity.last(), kind: 'activity' } satisfies WorkerEvent);
  window.on('message', (event) => respond(event.data as WorkerRequest, window, WINDOW_METHODS));
  window.on('close', () => windows.delete(window));
  window.start();
}

port.on('message', (event) => {
  const message = event.data as WorkerRequest | FrameResponse | { connect: true } | WorkerFocus;
  if ('focused' in message) {
    library.scheduler.setFocused(message.focused);
  } else if ('connect' in message) {
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
  },
} satisfies WorkerMessage);
library.share.watch(library.signal).catch(() => null);
watchFolder(library.root, library.signal, (changes) =>
  reportChanges({ backend, library, sendEvent: broadcast }, changes),
);
library.checkEveryFolder();
