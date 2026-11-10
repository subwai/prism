import type { PhotoLibrary } from '#photos/worker/library';
import type { PathChanges } from '#photos/worker/watcher';
import { debug, type FolderChanges, staleEntries, type WorkerEvent } from '@prism/shared';

const log = debug('worker:changes');

/**
 * Tells windows what changed on disk. Thumbnails and originals that are out of date are told at
 * once, as they need nothing more; the changes then wait for the views' versions that hold
 * them, so a window applies both together.
 */
async function report(
  library: PhotoLibrary,
  tell: (event: WorkerEvent) => void,
  { changed, everything }: PathChanges,
) {
  if (everything) {
    library.forget();
  }
  const changes: FolderChanges = {
    changed: everything ? [] : await library.describeChanges(changed),
    everything,
  };
  const stale = staleEntries(changes.changed);
  if (stale.length > 0) {
    tell({ stale });
  }
  log(
    'saw %o, told %o',
    changed.map(({ id }) => id),
    everything
      ? 'everything'
      : changes.changed.map(({ id, contentChanged, entry }) =>
          entry ? `${id}${contentChanged ? ' (rewritten)' : ''}` : `${id} (gone)`,
        ),
  );
  if (changes.everything || changes.changed.length > 0) {
    // Changes still go out if the catalog cannot say what the views are now.
    tell({ changes, views: await library.views.current().catch(() => []) });
  }
}

/** The batch being told, which the next waits for. A worker serves one library. */
let reporting: Promise<unknown> = Promise.resolve();

/** Tells windows, through `tell`, of a batch of changes, after those before it. */
export function reportChanges(
  library: PhotoLibrary,
  tell: (event: WorkerEvent) => void,
  changes: PathChanges,
): void {
  // A batch that fails to describe is lost, but must not stop the ones after it.
  reporting = reporting
    .then(() => report(library, tell, changes))
    .catch((error: unknown) => log('failed to describe: %s', String(error)));
}
