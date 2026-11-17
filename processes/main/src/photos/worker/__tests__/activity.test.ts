import { folder, launch } from '#photos/worker/__tests__/launches';
import { activityOf, activityReports } from '#photos/worker/activity';
import { Scheduler } from '#photos/worker/scheduler';
import { LIMITS } from '#photos/worker/scheduling';
import type { CatalogActivity } from '@prism/catalog';
import { type Activity, IDLE_ACTIVITY } from '@prism/shared';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, onTestFinished, test, vi } from 'vitest';

const IDLE_CATALOG: CatalogActivity = { saving: 0, skeleton: false, views: false };

test('walks under way that overlap count each folder once, and none is no walk', () => {
  // The launch's check of every folder, and a view's walk of some of the same folders.
  const walks = [
    { found: 3, full: true, looked: 1 },
    { found: 43_398, full: false, looked: 20_136 },
    { found: 1200, full: false, looked: 900 },
  ];
  expect(activityOf(IDLE_ACTIVITY.jobs, walks, IDLE_CATALOG).walk).toEqual({
    found: 43_398,
    full: true,
    looked: 20_136,
  });
  expect(activityOf(IDLE_ACTIVITY.jobs, [], IDLE_CATALOG)).toEqual(IDLE_ACTIVITY);
});

test('activity is sent a while after it changes, once, and not while it stays the same', async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  let now = activityOf(IDLE_ACTIVITY.jobs, [], IDLE_CATALOG);
  const sent: Activity[] = [];
  const reports = activityReports(
    () => now,
    (activity) => sent.push(activity),
  );
  now = activityOf(IDLE_ACTIVITY.jobs, [], { ...IDLE_CATALOG, saving: 10 });
  reports.changed();
  now = activityOf(IDLE_ACTIVITY.jobs, [], { ...IDLE_CATALOG, saving: 20 });
  reports.changed();
  expect(sent).toEqual([]);
  await vi.advanceTimersByTimeAsync(250);
  // The changes meanwhile are one message, of how things are once it is sent.
  expect(sent.map((activity) => activity.saving)).toEqual([20]);
  expect(reports.last().saving).toBe(20);
  reports.changed();
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);
});

test('the scheduler counts the jobs of each lane that run and wait, and tells as they change', async () => {
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
  expect(jobs.jobs().tile).toEqual({ running: limit, waiting: 2 });
  expect(jobs.jobs().folder).toEqual({ running: 0, waiting: 0 });
  expect(changes).toHaveBeenCalled();
  changes.mockClear();
  tiles[0]?.resolve(null);
  await setImmediate();
  expect(jobs.jobs().tile).toEqual({ running: limit, waiting: 1 });
  expect(changes).toHaveBeenCalled();
});

test('a library tells of its walk of every folder as it goes, and of nothing once it is done', async () => {
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
  expect(walks.at(-1)).toEqual({ found: 4, full: true, looked: 4 });
  // What it found was handed to the catalog, which then wrote it.
  expect(seen.some(({ saving }) => saving > 0)).toBe(true);
  await vi.waitFor(() => {
    expect(library.activity.current()).toEqual(IDLE_ACTIVITY);
  });
});
