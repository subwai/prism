import type { Share } from '#photos/worker/disk/share/share';
import type { LibraryChecks } from '#photos/worker/indexer/library-checks';
import type { Walks } from '#photos/worker/indexer/walks';
import type { Scheduler } from '#photos/worker/scheduler/scheduler';
import type { Catalog, CatalogActivity } from '@prism/catalog';
import type { Activity, FolderCheck, JobCounts, JobKind, WalkProgress } from '@prism/shared';

/** What `activityOf` builds the library's activity from. */
export interface ActivityParts {
  /** The scheduler's job counts. */
  jobs: Record<JobKind, JobCounts>;
  /** The folder walks under way. */
  walks: readonly WalkProgress[];
  /** How the library's last pass over every folder ended. */
  lastCheck: FolderCheck | null;
  /** What the catalog is busy with. */
  catalog: CatalogActivity;
  /** Whether the library's share is offline, which makes the work wait. */
  offline: boolean;
}

/**
 * What the library is busy with, for the status bar. Only the walk that has found the most
 * folders is shown. Walks overlap, such as a view's walk of a folder the library's check is also
 * walking, so adding their counts would count a folder once per walk. While the library's check
 * runs, it is the largest, and it holds the other walks' folders. `fullRead` says whether any
 * walk reads every folder in full.
 */
export function activityOf({ jobs, walks, lastCheck, catalog, offline }: ActivityParts): Activity {
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
      activityOf({
        catalog: catalog.activity(),
        jobs: scheduler.jobCounts(),
        lastCheck: checks.lastCheck(),
        offline: share.state === 'offline',
        walks: walks.list(),
      }),
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
