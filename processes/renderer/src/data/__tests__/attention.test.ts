import { AttentionReporter } from '#data/attention';
import { fakeAPI } from './fixtures.ts';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('what comes on show together is told in one message, whole', async () => {
  const api = fakeAPI([]);
  const attention = new AttentionReporter(api);
  attention.show('a.jpg');
  const gone = attention.show('b.jpg');
  attention.showTile('Trips');
  attention.showRows('view', 0, 24);
  gone();
  await vi.runAllTimersAsync();
  expect(api.attend.mock.calls).toEqual([
    [{ shown: ['a.jpg'], tiles: ['Trips'], views: [{ end: 24, start: 0, viewId: 'view' }] }],
  ]);
  attention.showRows('view', 8, 32);
  attention.hideRows('view');
  await vi.runAllTimersAsync();
  expect(api.attend.mock.calls.at(-1)).toEqual([{ shown: ['a.jpg'], tiles: ['Trips'], views: [] }]);
});

test('an entry is on show until every place that shows it lets it go', () => {
  const api = fakeAPI([]);
  const attention = new AttentionReporter(api);
  const tile = attention.show('a.jpg');
  const viewer = attention.show('a.jpg');
  tile();
  // Called twice, as a ref's cleanup can be, it counts once.
  tile();
  expect(attention.has('a.jpg')).toBe(true);
  viewer();
  expect(attention.has('a.jpg')).toBe(false);
});

test('a change that comes back to what was told sends nothing', async () => {
  const api = fakeAPI([]);
  const attention = new AttentionReporter(api);
  attention.show('a.jpg');
  await vi.runAllTimersAsync();
  attention.show('b.jpg')();
  await vi.runAllTimersAsync();
  expect(api.attend).toHaveBeenCalledOnce();
  attention.close();
});
