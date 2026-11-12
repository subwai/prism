import type { PathChange } from '#photos/worker/changes';
import { isIgnored } from '@prism/media';
import { debug } from '@prism/shared';
import { type FSWatcher, watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Changes are reported at most this often, so copying many files updates the view a few times
// a second rather than once per file.
const BATCH_MS = 250;
// How often the folder is checked to still be the one being watched.
const CHECK_MS = 2000;
// Past this, rereading everything is cheaper than updating entry by entry.
const MAX_CHANGES = 10_000;

const log = debug('worker:watcher');

export interface PathChanges {
  changed: PathChange[];
  /** Too much changed to list, or the system could not say what. */
  everything: boolean;
}

/** Which folder is at `root`, or `null` if none can be read there. */
async function identify(root: string) {
  try {
    const info = await stat(root);
    return `${info.dev}:${info.ino}`;
  } catch {
    return null;
  }
}

/** Reports changes anywhere under `root`, in batches, until `signal` aborts. */
export function watchFolder(
  root: string,
  signal: AbortSignal,
  report: (changes: PathChanges) => void,
): void {
  let changed = new Map<string, PathChange>();
  let everything = false;
  let timer: NodeJS.Timeout | undefined;
  function flush() {
    timer = undefined;
    const changes = { changed: everything ? [] : [...changed.values()], everything };
    changed = new Map();
    everything = false;
    if (changes.everything || changes.changed.length > 0) {
      report(changes);
    }
  }
  function schedule() {
    timer ??= setTimeout(flush, BATCH_MS);
  }
  function reportEverything() {
    everything = true;
    schedule();
  }
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true });

  let watcher: FSWatcher | undefined;
  function start() {
    // Recursive watching uses FSEvents on macOS and native recursion on Windows; on Linux,
    // Node watches each folder itself.
    log('watching %s', root);
    const current = watch(root, { recursive: true, signal }, (event, filename) => {
      log('%s %s', event, filename);
      if (filename === null) {
        everything = true;
      } else {
        const id = path.normalize(filename);
        if (isIgnored(path.basename(id))) {
          return;
        }
        changed.set(id, { id, parentId: path.dirname(id) });
        everything ||= changed.size > MAX_CHANGES;
      }
      schedule();
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
  // stays silent. Neither Node nor the system says so, so the folder is checked every so
  // often to still be the one watched, and watched again when it is not.
  async function keepWatching(initial: string | null) {
    let known = initial;
    while (!signal.aborted) {
      await delay(CHECK_MS, undefined, { signal }).catch(() => null);
      const current = await identify(root);
      if (signal.aborted || (current === known && (watcher || current === null))) {
        continue;
      }
      const before = known;
      known = current;
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
  }

  start();
  identify(root)
    .then(keepWatching)
    .catch(() => null);
}
