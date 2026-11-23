import { activityDetails } from '#data/activity/activity-rows';
import {
  type Activity,
  type FolderCheck,
  IDLE_ACTIVITY,
  type JobCounts,
  type JobKind,
} from '@prism/shared';
import { expect, test } from 'vitest';

const MINUTE_MS = 60_000;
/** The time the rows are put into words at. */
const NOW = 1_800_000_000_000;

function activity({
  jobs = {},
  ...rest
}: Partial<Omit<Activity, 'jobs'>> & {
  jobs?: Partial<Record<JobKind, JobCounts>>;
} = {}): Activity {
  return { ...IDLE_ACTIVITY, ...rest, jobs: { ...IDLE_ACTIVITY.jobs, ...jobs } };
}

/** Each row as `label: value`, dimmed rows marked so. */
function rows(of: Activity) {
  return activityDetails(of, null, NOW).map(
    ({ active, label, value }) => `${label}: ${value}${active ? '' : ' (idle)'}`,
  );
}

const IDLE_ROWS = [
  'Folders: Not checked yet (idle)',
  'Thumbnails: Idle (idle)',
  'Photo details: Idle (idle)',
  'Folder covers: Idle (idle)',
  'Conversions: Idle (idle)',
  'Catalog writes: Idle (idle)',
  'View order: Idle (idle)',
  'Folder tree: Idle (idle)',
];

test('every kind of work has its row, in its place, idle or not', () => {
  expect(rows(activity())).toEqual(IDLE_ROWS);
  expect(
    rows(
      activity({
        jobs: {
          conversion: { running: 1, waiting: 0 },
          details: { running: 4, waiting: 1203 },
          folder: { running: 12, waiting: 4 },
          tile: { running: 0, waiting: 3 },
        },
        rebuildingTree: true,
        rebuildingViews: true,
        unsavedEntries: 1,
        walk: { found: 43_112, fullRead: false, looked: 12_340 },
      }),
    ),
  ).toEqual([
    // The walk's reads are the folder lane's, so they are not counted again.
    'Folders: Checking · 12,340 of 43,112',
    'Thumbnails: Idle (idle)',
    'Photo details: 4 running · 1,203 waiting',
    'Folder covers: 3 waiting',
    'Conversions: 1 running',
    'Catalog writes: 1 entry',
    'View order: Sorting',
    'Folder tree: Rebuilding',
  ]);
});

test('the folders row shows how far a walk has got, and keeps its bar without one', () => {
  const [walking] = activityDetails(
    activity({ walk: { found: 10, fullRead: true, looked: 2 } }),
    null,
    NOW,
  );
  expect(walking).toMatchObject({ progress: 0.2, value: 'Reading all · 2 of 10' });
  const [reading] = activityDetails(
    activity({ jobs: { folder: { running: 1, waiting: 0 } } }),
    null,
    NOW,
  );
  expect(reading).toMatchObject({ progress: 0, value: '1 running' });
});

/** The folders row of an activity with `fields`. */
function foldersRow(fields: Parameters<typeof activity>[0]) {
  return activityDetails(activity(fields), null, NOW)[0];
}

/** A look at every folder that ended `minutes` before `NOW`. */
function lastCheck(minutes: number, rest: Partial<FolderCheck> = {}): FolderCheck {
  return {
    complete: true,
    endedMs: NOW - minutes * MINUTE_MS,
    found: 400,
    fullRead: false,
    looked: 400,
    ...rest,
  };
}

test('the folders row says how long ago the folders were checked once no walk is under way', () => {
  expect(foldersRow({})).toMatchObject({
    active: false,
    progress: 0,
    value: 'Not checked yet',
  });
  expect(foldersRow({ lastCheck: lastCheck(0.5) })).toMatchObject({
    active: false,
    progress: 1,
    value: 'Up to date · checked just now',
  });
  expect(foldersRow({ lastCheck: lastCheck(12.9) })?.value).toBe('Up to date · checked 12 min ago');
  expect(foldersRow({ lastCheck: lastCheck(3 * 60) })?.value).toBe('Up to date · checked 3 h ago');
  expect(foldersRow({ lastCheck: lastCheck(3 * 24 * 60) })?.value).toBe(
    'Up to date · checked 3 days ago',
  );
  // Folders read outside a walk, as the watcher's, keep the bar where the check left it.
  const lane = { folder: { running: 1, waiting: 2 } };
  expect(foldersRow({ jobs: lane, lastCheck: lastCheck(1) })).toMatchObject({
    active: true,
    progress: 1,
    value: '1 running · 2 waiting',
  });
});

test('the folders row says a look at every folder stopped part-way, as far as it got', () => {
  expect(
    foldersRow({ lastCheck: lastCheck(5, { complete: false, fullRead: true, looked: 166 }) }),
  ).toMatchObject({ active: false, progress: 166 / 400, value: 'Full read paused · 41% read' });
  expect(foldersRow({ lastCheck: lastCheck(5, { complete: false, looked: 40 }) })).toMatchObject({
    active: false,
    progress: 0.1,
    value: 'Check stopped · 10% checked',
  });
});

test('the folders row says the share is offline, with the bar where the walk or check got to', () => {
  const walk = { found: 10, fullRead: false, looked: 4 };
  expect(foldersRow({ offline: true, walk })).toMatchObject({
    active: false,
    progress: 0.4,
    value: 'Share offline · 4 of 10',
  });
  expect(foldersRow({ lastCheck: lastCheck(20), offline: true })).toMatchObject({
    active: false,
    progress: 1,
    value: 'Share offline',
  });
  expect(foldersRow({ offline: true })).toMatchObject({
    progress: 0,
    value: 'Share offline',
  });
});

test('thumbnails count the photos read, decoded, and waiting for either', () => {
  // A thumbnail's job runs from its read through its decode.
  const jobs = { decode: { running: 8, waiting: 2 }, thumbnail: { running: 26, waiting: 38 } };
  expect(activityDetails(activity({ jobs }), null, NOW)[1]?.value).toBe(
    '16 reading · 8 decoding · 40 waiting',
  );
});

/** The photo details row of `of`, with `left` ms of reading left. */
function photoDetails(of: Activity, left: number | null) {
  return activityDetails(of, left, NOW)[2];
}

test('the photo details row shows how many of the library’s photos are read, and the time left', () => {
  const lane = { details: { running: 4, waiting: 40 } };
  const details = { photos: 1_746_119, read: 28_096, unreadable: 0 };
  // Until the catalog has counted, the jobs that read them.
  expect(photoDetails(activity({ jobs: lane }), null)).toMatchObject({
    progress: 0,
    value: '4 running · 40 waiting',
  });
  expect(photoDetails(activity({ details, jobs: lane }), null)).toMatchObject({
    active: true,
    progress: details.read / details.photos,
    value: '28,096 of 1,746,119',
  });
  expect(photoDetails(activity({ details, jobs: lane }), 23 * 3_600_000)).toMatchObject({
    value: '28,096 of 1,746,119 · about 23 h left',
  });
  // Paused, it keeps its count, dimmed, with no time left.
  expect(photoDetails(activity({ details }), 23 * 3_600_000)).toMatchObject({
    active: false,
    value: '28,096 of 1,746,119',
  });
  expect(
    photoDetails(activity({ details: { photos: 12, read: 12, unreadable: 0 } }), null),
  ).toMatchObject({
    active: false,
    progress: 1,
    value: 'All read',
  });
});

test('the photo details row says how many photos’ details could not be read, which count as read', () => {
  const lane = { details: { running: 4, waiting: 40 } };
  expect(
    photoDetails(
      activity({ details: { photos: 40, read: 12, unreadable: 3 }, jobs: lane }),
      60_000,
    ),
  ).toMatchObject({ value: '12 of 40 · 3 unreadable · about 1 min left' });
  expect(
    photoDetails(activity({ details: { photos: 1200, read: 1200, unreadable: 1100 } }), null),
  ).toMatchObject({ active: false, progress: 1, value: 'All read · 1,100 unreadable' });
});

test('the photo details row shows how far forgetting every photo’s details has got', () => {
  const forgetting = activity({
    details: { photos: 10, read: 10, unreadable: 0 },
    forgettingDetails: { done: 20_000, total: 80_000 },
  });
  expect(rows(forgetting)[2]).toBe('Photo details: Forgetting · 25%');
  expect(activityDetails(forgetting, null, NOW)[2]?.progress).toBe(0.25);
});
