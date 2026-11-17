import type { Scheduler } from '#photos/worker/scheduler';
import type { Walks } from '#photos/worker/walks';
import type { Catalog, CatalogActivity } from '@prism/catalog';
import type { Activity, Jobs, Lane, WalkProgress } from '@prism/shared';

// Activity is sent at most this often, so the scheduler's thousands of jobs a minute cost the
// window a few messages a second.
const ACTIVITY_MS = 250;

/**
 * What the library is busy with: the scheduler's `jobs`, the `walks` under way, added together,
 * and what the `catalog` is busy with. Walks that overlap, as a view's of a folder the library's
 * check is walking too, each count the folders they share, which are read once.
 */
export function activityOf(
  jobs: Record<Lane, Jobs>,
  walks: readonly WalkProgress[],
  catalog: CatalogActivity,
): Activity {
  const walk =
    walks.length === 0
      ? null
      : {
          found: walks.reduce((sum, each) => sum + each.found, 0),
          full: walks.some((each) => each.full),
          looked: walks.reduce((sum, each) => sum + each.looked, 0),
        };
  return { jobs, walk, ...catalog };
}

/**
 * What a library is busy with, from its `scheduler`, its indexer's `walks` and its `catalog`:
 * `current` counts it now, and `onChange` hears whenever it may have changed.
 */
export function libraryActivity(sources: { catalog: Catalog; scheduler: Scheduler; walks: Walks }) {
  const { catalog, scheduler, walks } = sources;
  return {
    current: () => activityOf(scheduler.jobs(), walks.walking(), catalog.activity()),
    onChange(listener: () => void): () => void {
      const stops = [
        scheduler.onChange(listener),
        walks.onChange(listener),
        catalog.onActivity(listener),
      ];
      return () => stops.map((stop) => stop());
    },
  };
}

/**
 * Sends `current()` as it changes: `changed` says it may have, and it is sent once a while
 * later, and only if it differs from what was sent last, so nothing is sent while nothing
 * changes. `last` is what was sent last, for a window that connects meanwhile.
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
