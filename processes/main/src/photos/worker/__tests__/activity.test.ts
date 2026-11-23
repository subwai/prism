import { folder, launch } from '#photos/worker/__tests__/launches';
import { activityOf, activityReports } from '#photos/worker/activity';
import { LIMITS } from '#photos/worker/scheduler/limits';
import { Scheduler } from '#photos/worker/scheduler/scheduler';
import type { CatalogActivity } from '@prism/catalog';
import { type Activity, IDLE_ACTIVITY } from '@prism/shared';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, onTestFinished, test, vi } from 'vitest';

const IDLE_CATALOG: CatalogActivity = {
  details: null,
  rebuildingTree: false,
  rebuildingViews: false,
  unsavedEntries: 0,
};

test('walks under way that overlap count each folder once, and none is no walk', () => {
  // The launch's check of every folder, and a view's walk of some of the same folders.
  const walks = [
    { found: 3, fullRead: true, looked: 1 },
    { found: 43_398, fullRead: false, looked: 20_136 },
    { found: 1200, fullRead: false, looked: 900 },
  ];
  expect(
    activityOf({
      catalog: IDLE_CATALOG,
      jobs: IDLE_ACTIVITY.jobs,
      lastCheck: null,
      offline: false,
      walks,
    }).walk,
  ).toEqual({
    found: 43_398,
    fullRead: true,
    looked: 20_136,
  });
  expect(
    activityOf({
      catalog: IDLE_CATALOG,
      jobs: IDLE_ACTIVITY.jobs,
      lastCheck: null,
      offline: false,
      walks: [],
    }),
  ).toEqual(IDLE_ACTIVITY);
});

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

test('the scheduler counts the jobs of each kind that run and wait, and reports when they change', async () => {
  const controller = new AbortController();
  onTestFinished(() => controller.abort());
  const jobs = new Scheduler(controller.signal);
  const changes = vi.fn();
  jobs.onChange(changes);
  const limit = LIMITS.tile.visible;
  const tiles = Array.from({ length: limit + 2 }, () => Promise.withResolvers<null>());
  for (const [index, tile] of tiles.entries()) {
    const work = () => tile.promise;
    jobs.run('tile', `tile ${index}`, () => 'visible', work).catch(() => null);
  }
  await setImmediate();
  expect(jobs.jobCounts().tile).toEqual({ running: limit, waiting: 2 });
  expect(jobs.jobCounts().folder).toEqual({ running: 0, waiting: 0 });
  expect(changes).toHaveBeenCalled();
  changes.mockClear();
  tiles[0]?.resolve(null);
  await setImmediate();
  expect(jobs.jobCounts().tile).toEqual({ running: limit, waiting: 1 });
  expect(changes).toHaveBeenCalled();
});

test('a library reports its walk of every folder as it goes, and no walk once it is done', async () => {
  const root = await folder('activity-');
  const catalog = await folder('activity-catalog-');
  await mkdir(path.join(root, 'Trips', 'Beach'), { recursive: true });
  await mkdir(path.join(root, 'Work'));
  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'a');
  const library = launch(root, catalog);
  const seen: Activity[] = [];
  library.activity.onChange(() => seen.push(library.activity.current()));
  await library.checkEveryFolder();
  const walks = seen.flatMap(({ walk }) => (walk ? [walk] : []));
  expect(walks.at(-1)).toEqual({ found: 4, fullRead: true, looked: 4 });
  // What it found was handed to the catalog, which then wrote it.
  expect(seen.some(({ unsavedEntries }) => unsavedEntries > 0)).toBe(true);
  // Its one photo is no JPEG, so its details cannot be read, and it stays unread.
  await vi.waitFor(() => {
    expect(library.activity.current()).toEqual({
      ...IDLE_ACTIVITY,
      details: { photos: 1, read: 0, unreadable: 0 },
      // The first launch reads every folder in full.
      lastCheck: {
        complete: true,
        endedMs: expect.any(Number),
        found: 4,
        fullRead: true,
        looked: 4,
      },
    });
  });
});

test('a library reports a pass over every folder that stopped part-way because its own folder failed', async () => {
  const root = await folder('activity-');
  const catalog = await folder('activity-catalog-');
  const library = launch(root, catalog);
  await rm(root, { recursive: true });
  await library.checkEveryFolder();
  expect(library.activity.current().lastCheck).toMatchObject({ complete: false, fullRead: true });
});
