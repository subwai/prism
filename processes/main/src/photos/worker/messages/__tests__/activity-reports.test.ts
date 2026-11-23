import { activityOf } from '#photos/worker/library/activity';
import { activityReports } from '#photos/worker/messages/activity-reports';
import type { CatalogActivity } from '@prism/catalog';
import { type Activity, IDLE_ACTIVITY } from '@prism/shared';
import { expect, onTestFinished, test, vi } from 'vitest';

const IDLE_CATALOG: CatalogActivity = {
  details: null,
  rebuildingTree: false,
  rebuildingViews: false,
  unsavedEntries: 0,
};

test('activity is sent a while after it changes, once, and not while it stays the same', async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  let now = activityOf({
    catalog: IDLE_CATALOG,
    jobs: IDLE_ACTIVITY.jobs,
    lastCheck: null,
    offline: false,
    walks: [],
  });
  const sent: Activity[] = [];
  const reports = activityReports(
    () => now,
    (activity) => sent.push(activity),
  );
  now = activityOf({
    catalog: { ...IDLE_CATALOG, unsavedEntries: 10 },
    jobs: IDLE_ACTIVITY.jobs,
    lastCheck: null,
    offline: false,
    walks: [],
  });
  reports.changed();
  now = activityOf({
    catalog: { ...IDLE_CATALOG, unsavedEntries: 20 },
    jobs: IDLE_ACTIVITY.jobs,
    lastCheck: null,
    offline: false,
    walks: [],
  });
  reports.changed();
  expect(sent).toEqual([]);
  await vi.advanceTimersByTimeAsync(250);
  // The changes meanwhile are one message, of how things are once it is sent.
  expect(sent.map((activity) => activity.unsavedEntries)).toEqual([20]);
  expect(reports.last().unsavedEntries).toBe(20);
  reports.changed();
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);
});
