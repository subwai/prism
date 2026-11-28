import type { PathChange } from '#photos/worker/changes/describe-changes';
import type { Share } from '#photos/worker/disk/share/share';
import { isIgnored } from '@prism/media';
import { debug, DelayedCall } from '@prism/shared';
import { type FSWatcher, watch } from 'node:fs';
import path from 'node:path';

// Changes are reported at most this often, so copying many files updates the view a few times
// a second rather than once per file.
const BATCH_MS = 250;
// Past this, rereading everything is cheaper than updating entry by entry.
const MAX_CHANGES = 10_000;

const log = debug('worker:watcher');

export interface PathChanges {
  changed: PathChange[];
  /** Too much changed to list, or the system could not say what. */
  everything: boolean;
}

/** What `watchFolder` watches, and whom it tells. */
export interface FolderToWatch {
  root: string;
  /** The library's share, whose checks say which folder is at `root`. */
  share: Share;
  signal: AbortSignal;
  report: (changes: PathChanges) => void;
}

/** Reports changes anywhere under `root`, in batches, until `signal` aborts. */
export function watchFolder({ root, share, signal, report }: FolderToWatch): void {
  let changed = new Map<string, PathChange>();
  let everything = false;
  function flush() {
    const changes = { changed: everything ? [] : [...changed.values()], everything };
    changed = new Map();
    everything = false;
    if (changes.everything || changes.changed.length > 0) {
      report(changes);
    }
  }
  const flushSoon = new DelayedCall(flush, BATCH_MS);
  function reportEverything() {
    everything = true;
    flushSoon.request();
  }
  signal.addEventListener('abort', () => flushSoon.cancel(), { once: true });

  let watcher: FSWatcher | undefined;
  function start() {
    // Recursive watching uses FSEvents, macOS's reports of changes to files, on macOS and native
    // recursion on Windows; on Linux, Node watches each folder itself.
    log('watching %s', root);
    const current = watch(root, { recursive: true, signal }, (event, filename) => {
      log('%s %s', event, filename);
      if (filename === null) {
        everything = true;
      } else {
        const id = path.normalize(filename);
        // Anything inside an ignored folder too, such as Prism's Trash.
        if (id.split(path.sep).some((segment) => isIgnored(segment))) {
          return;
        }
        changed.set(id, { id, parentId: path.dirname(id) });
        everything ||= changed.size > MAX_CHANGES;
      }
      flushSoon.request();
    });
    // The folder itself may disappear; reading it again then shows why, and the checks below
    // watch it again once it is back.
    current.on('error', (error) => {
      log('failed: %s', String(error));
      current.close();
      if (watcher === current && !signal.aborted) {
        watcher = undefined;
        reportEverything();
      }
    });
    watcher = current;
  }

  // A volume that unmounts, as a network share does when its connection drops or the Mac
  // sleeps, raises no event or error, and a watcher started before it was mounted again
  // stays silent. Neither Node nor the system says so, so each check of the share says which
  // folder is at `root`, and the folder is watched again when it is not the one watched. The
  // share's checks give up after a few seconds on a share that does not answer, so this never
  // waits on one; a check that gave up says nothing here.
  let known: string | null | undefined;
  function followCheck(current: string | null) {
    const before = known === undefined ? current : known;
    known = current;
    if (current === before && (watcher || current === null)) {
      return;
    }
    watcher?.close();
    watcher = undefined;
    if (current !== null) {
      try {
        start();
      } catch {
        // Not readable yet; the next check tries again.
      }
    }
    // What changed while nothing was watching went unseen, and the folder may be gone.
    if (current !== before || watcher) {
      reportEverything();
    }
  }

  try {
    start();
  } catch {
    // Gone, as a library may be when it opens from its catalog; the checks watch it once back.
  }
  const stopFollowing = share.onFolderChecked(followCheck);
  signal.addEventListener('abort', stopFollowing, { once: true });
}
