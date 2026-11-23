import type { Activity } from '@prism/shared';

/**
 * Sent when a catalog thread starts or stops a large job beside answering calls. The status
 * bar shows it.
 */
export interface BusyChange {
  kind: 'busy';
  /**
   * Which job: the reader rebuilding views on the views' thread, or the writer rebuilding the
   * stored tree listing once writes go quiet.
   */
  activity: keyof Pick<Activity, 'rebuildingTree' | 'rebuildingViews'>;
  /** Whether the job is starting (`true`) or done (`false`). */
  busy: boolean;
}

/** What the catalog is busy with, beside answering calls; see `Activity`. */
export type CatalogActivity = Pick<
  Activity,
  'details' | 'forgettingDetails' | 'rebuildingTree' | 'rebuildingViews' | 'unsavedEntries'
>;
