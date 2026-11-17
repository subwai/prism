import { activityDetails } from '#data/activity';
import { type Activity, type Jobs, type Lane, LANES } from '@prism/shared';
import { expect, test } from 'vitest';

function activity({
  jobs = {},
  ...rest
}: Partial<Omit<Activity, 'jobs'>> & { jobs?: Partial<Record<Lane, Jobs>> } = {}): Activity {
  const none = Object.fromEntries(LANES.map((lane) => [lane, { running: 0, waiting: 0 }]));
  return {
    jobs: { ...none, ...jobs } as Record<Lane, Jobs>,
    saving: 0,
    skeleton: false,
    views: false,
    walk: null,
    ...rest,
  };
}

/** Each row as `label: value`, dimmed rows marked so. */
function rows(of: Activity) {
  return activityDetails(of).map(
    ({ active, label, value }) => `${label}: ${value}${active ? '' : ' (idle)'}`,
  );
}

const IDLE_ROWS = [
  'Folders: Idle (idle)',
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
        saving: 1,
        skeleton: true,
        views: true,
        walk: { found: 43_112, full: false, looked: 12_340 },
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
  const [walking] = activityDetails(activity({ walk: { found: 10, full: true, looked: 2 } }));
  expect(walking).toMatchObject({ progress: 0.2, value: 'Reading all · 2 of 10' });
  const [reading] = activityDetails(activity({ jobs: { folder: { running: 1, waiting: 0 } } }));
  expect(reading).toMatchObject({ progress: 0, value: '1 running' });
});

test('thumbnails count the photos read, decoded, and waiting for either', () => {
  // A thumbnail's job runs from its read through its decode.
  const jobs = { decode: { running: 8, waiting: 2 }, thumbnail: { running: 26, waiting: 38 } };
  expect(activityDetails(activity({ jobs }))[1]?.value).toBe(
    '16 reading · 8 decoding · 40 waiting',
  );
});
