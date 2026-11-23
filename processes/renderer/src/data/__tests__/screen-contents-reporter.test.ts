import { ScreenContentsReporter } from '#data/screen-contents-reporter';
import { fakeAPI } from './fixtures.ts';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('what comes on screen together is sent in one message, whole', async () => {
  const api = fakeAPI([]);
  const reporter = new ScreenContentsReporter(api);
  reporter.markEntryOnScreen('a.jpg');
  const gone = reporter.markEntryOnScreen('b.jpg');
  reporter.markFolderToRead('Trips');
  reporter.showRows('view', 0, 24);
  gone();
  await vi.runAllTimersAsync();
  expect(api.reportScreenContents.mock.calls).toEqual([
    [
      {
        foldersToRead: ['Trips'],
        shown: ['a.jpg'],
        views: [{ end: 24, start: 0, viewId: 'view' }],
      },
    ],
  ]);
  reporter.showRows('view', 8, 32);
  reporter.hideRows('view');
  await vi.runAllTimersAsync();
  expect(api.reportScreenContents.mock.calls.at(-1)).toEqual([
    { foldersToRead: ['Trips'], shown: ['a.jpg'], views: [] },
  ]);
});

test('an entry is on screen until every place that shows it lets it go', () => {
  const api = fakeAPI([]);
  const reporter = new ScreenContentsReporter(api);
  const tile = reporter.markEntryOnScreen('a.jpg');
  const viewer = reporter.markEntryOnScreen('a.jpg');
  tile();
  // Called twice, as a ref's cleanup can be, it counts once.
  tile();
  expect(reporter.isEntryOnScreen('a.jpg')).toBe(true);
  viewer();
  expect(reporter.isEntryOnScreen('a.jpg')).toBe(false);
});

test('a change that comes back to what was sent sends nothing', async () => {
  const api = fakeAPI([]);
  const reporter = new ScreenContentsReporter(api);
  reporter.markEntryOnScreen('a.jpg');
  await vi.runAllTimersAsync();
  reporter.markEntryOnScreen('b.jpg')();
  await vi.runAllTimersAsync();
  expect(api.reportScreenContents).toHaveBeenCalledOnce();
  reporter.close();
});
