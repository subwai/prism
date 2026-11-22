import type { LibraryChecks } from '#photos/worker/indexer/library-checks';
import type { Walks } from '#photos/worker/indexer/walks';
import type { Scheduler } from '#photos/worker/scheduler/scheduler';
import type { Share } from '#photos/worker/share/share';
import type { Catalog, CatalogActivity } from '@prism/catalog';
import type { Activity, FolderCheck, JobCounts, JobKind, WalkProgress } from '@prism/shared';

// Activity is sent at most this often, so the scheduler's thousands of jobs a minute cost the
// window a few messages a second.
const ACTIVITY_MS = 250;

/**
 * What the library is busy with, for the status bar.
 * - `jobs`: the scheduler's job counts.
 * - `walks`: only the walk that has found the most folders is shown. Walks overlap, such as a
 *   view's walk of a folder the library's check is also walking, so adding their counts would
 *   count a folder once per walk. While the library's check runs, it is the largest, and it holds
 *   the other walks' folders. `fullRead` says whether any walk reads every folder in full.
 * - `lastCheck`: how the library's last pass over every folder ended.
 * - `catalog`: what the catalog is busy with.
 * - `offline`: whether the library's share is offline, which makes the work wait.
 */
export function activityOf(
  jobs: Record<JobKind, JobCounts>,
  walks: readonly WalkProgress[],
  lastCheck: FolderCheck | null,
  catalog: CatalogActivity,
  offline: boolean,
): Activity {
  const [largest] = walks.toSorted((one, other) => other.found - one.found);
  const walk =
    largest === undefined
      ? null
      : {
          found: largest.found,
          fullRead: walks.some((each) => each.fullRead),
          looked: largest.looked,
        };
  return { jobs, lastCheck, offline, walk, ...catalog };
}

/**
 * What a library is busy with, from its `scheduler`, its indexer's `walks`, its `checks` of every
 * folder, its `catalog`, and whether its `share` is offline. `current` works it out now, and
 * `onChange` listeners are called whenever it may have changed.
 */
export function libraryActivity(sources: {
  catalog: Catalog;
  checks: LibraryChecks;
  scheduler: Scheduler;
  share: Share;
  walks: Walks;
}) {
  const { catalog, checks, scheduler, share, walks } = sources;
  return {
    current: () =>
      activityOf(
        scheduler.jobCounts(),
        walks.list(),
        checks.lastCheck(),
        catalog.activity(),
        share.state === 'offline',
      ),
    onChange(listener: () => void): () => void {
      const stops = [
        scheduler.onChange(listener),
        walks.onChange(listener),
        checks.onChange(listener),
        catalog.onActivity(listener),
        share.onChange(listener),
      ];
      return () => stops.map((stop) => stop());
    },
  };
}

/**
 * Sends `current()` when it changes. Calling `changed` says it may have: it is then sent once,
 * a moment later, and only if it differs from what was sent last, so nothing is sent while
 * nothing changes. `last` returns what was sent last, for a window that connects meanwhile.
 */
export function activityReports(current: () => Activity, send: (activity: Activity) => void) {
  let last = current();
  let sent = JSON.stringify(last);
  let timer: NodeJS.Timeout | undefined;
  return {
    changed(): void {
      timer ??= setTimeout(() => {
        timer = undefined;
        const now = current();
        const text = JSON.stringify(now);
        if (text !== sent) {
          last = now;
          sent = text;
          send(now);
        }
      }, ACTIVITY_MS);
    },
    last: () => last,
  };
}
