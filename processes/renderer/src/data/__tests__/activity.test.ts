import { activityLines } from '#data/activity';
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

test('nothing under way says nothing', () => {
  expect(activityLines(activity())).toEqual([]);
});

test('the work under way is a line each, with counts', () => {
  expect(
    activityLines(
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
    // The walk's reads are the folder lane's, so they are not told of again.
    'Checking folders for changes — 12,340 of 43,112',
    'Converting photos to show — 1 running',
    'Finding folders’ covers — 3 waiting',
    'Reading photo details — 4 running, 1,203 waiting',
    'Saving to the catalog — 1 entry',
    'Sorting and filtering the view',
    'Rebuilding the folder tree',
  ]);
});

test('a full read says so, and folders read without a walk are counted', () => {
  expect(activityLines(activity({ walk: { found: 10, full: true, looked: 2 } }))).toEqual([
    'Reading every folder again — 2 of 10',
  ]);
  expect(activityLines(activity({ jobs: { folder: { running: 1, waiting: 0 } } }))).toEqual([
    'Reading folders — 1 running',
  ]);
});

test('thumbnails count the photos read, decoded, and waiting for either', () => {
  // A thumbnail's job runs from its read through its decode.
  const jobs = { decode: { running: 8, waiting: 2 }, thumbnail: { running: 26, waiting: 38 } };
  expect(activityLines(activity({ jobs }))).toEqual([
    'Making thumbnails — 16 reading, 8 decoding, 40 waiting',
  ]);
});
