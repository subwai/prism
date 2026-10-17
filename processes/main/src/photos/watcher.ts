import type { PathChange } from '#photos/changes';
import { isIgnored } from '#photos/media';
import { watch } from 'node:fs';
import path from 'node:path';

// Changes are reported at most this often, so copying many files updates the view a few times
// a second rather than once per file.
const BATCH_MS = 250,
  // Past this, rereading everything is cheaper than updating entry by entry.
  MAX_CHANGES = 10_000;

export interface PathChanges {
  changed: PathChange[];
  /** Too much changed to list, or the system could not say what. */
  everything: boolean;
}

/** Reports changes anywhere under `root`, in batches, until `signal` aborts. */
export function watchFolder(
  root: string,
  signal: AbortSignal,
  report: (changes: PathChanges) => void
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
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  // Recursive watching uses FSEvents on macOS and native recursion on Windows; on Linux, Node
  // watches each folder itself.
  const watcher = watch(root, { recursive: true, signal }, (_event, filename) => {
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
  // The folder itself may disappear; reading it again then shows why.
  watcher.on('error', () => {
    if (!signal.aborted) {
      everything = true;
      schedule();
    }
  });
}
