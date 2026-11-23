import type { WorkerBackend } from '#photos/worker/backend';
import type { PathChanges } from '#photos/worker/changes/watcher';
import type { PhotoLibrary } from '#photos/worker/library';
import { debug, findStaleEntryIds, type FolderChanges, type WorkerEvent } from '@prism/shared';

const log = debug('worker:changes');

/** Where a batch of changes goes: the library, its worker's backend, and the windows. */
export interface ChangeTargets {
  library: PhotoLibrary;
  backend: Pick<WorkerBackend, 'remakeStaleThumbnails'>;
  sendEvent: (event: WorkerEvent) => void;
}

/**
 * Sends the windows what changed on disk, in two steps.
 * 1. The entries whose thumbnails and originals are out of date are sent at once, as they need
 *    nothing more. Only then are the thumbnails on screen made again, so the new ones arrive
 *    after the window has dropped the old ones.
 * 2. The changes themselves wait for the views' versions that include them, and go out together
 *    with those versions, so a window applies both at once.
 */
async function sendChanges(
  { library, backend, sendEvent }: ChangeTargets,
  { changed, everything }: PathChanges,
) {
  if (everything) {
    library.forget();
  }
  const changes: FolderChanges = {
    changed: everything ? [] : await library.describeChanges(changed),
    everything,
  };
  const stale = findStaleEntryIds(changes.changed);
  if (stale.length > 0) {
    sendEvent({ entryIds: stale, kind: 'stale' });
    backend.remakeStaleThumbnails(stale);
  }
  log(
    'saw %o, sent %o',
    changed.map(({ id }) => id),
    everything
      ? 'everything'
      : changes.changed.map(({ id, contentChanged, entry }) =>
          entry ? `${id}${contentChanged ? ' (rewritten)' : ''}` : `${id} (gone)`,
        ),
  );
  if (changes.everything || changes.changed.length > 0) {
    // Changes still go out if the catalog cannot say what the views are now.
    const views = await library.views.current().catch(() => []);
    sendEvent({ kind: 'update', update: { changes, views } });
  }
}

/** The batch being sent, which the next one waits for. A worker serves one library. */
let sending: Promise<unknown> = Promise.resolve();

/** Sends the windows a batch of changes, after the batches before it. */
export function reportChanges(to: ChangeTargets, changes: PathChanges): void {
  // A batch that fails to describe is lost, but must not stop the ones after it.
  sending = sending
    .then(() => sendChanges(to, changes))
    .catch((error: unknown) => log('failed to describe: %s', String(error)));
}
