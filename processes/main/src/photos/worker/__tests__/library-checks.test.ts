import { fullReadDue } from '#photos/worker/library-checks';
import { expect, test } from 'vitest';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY_MS;

test('a launch reads every folder in full once the last full read is over a week old, or none was', () => {
  expect(fullReadDue({ lastMs: null, startedMs: null }, NOW)).toBe('new');
  expect(fullReadDue({ lastMs: NOW - 8 * DAY_MS, startedMs: null }, NOW)).toBe('new');
  expect(fullReadDue({ lastMs: NOW - 7 * DAY_MS, startedMs: null }, NOW)).toBeNull();
  expect(fullReadDue({ lastMs: NOW - DAY_MS, startedMs: null }, NOW)).toBeNull();
});

test('a launch takes up again a full read the library closed during, unless it began over a week ago', () => {
  const started = NOW - 2 * DAY_MS;
  expect(fullReadDue({ lastMs: null, startedMs: started }, NOW)).toBe(started);
  expect(fullReadDue({ lastMs: NOW - 9 * DAY_MS, startedMs: started }, NOW)).toBe(started);
  expect(fullReadDue({ lastMs: null, startedMs: NOW - 7 * DAY_MS }, NOW)).toBe(NOW - 7 * DAY_MS);
  expect(fullReadDue({ lastMs: null, startedMs: NOW - 8 * DAY_MS }, NOW)).toBe('new');
  // One began after the last got to the end, as the person asked, waits until a full read is due.
  expect(fullReadDue({ lastMs: NOW - DAY_MS, startedMs: NOW - DAY_MS / 2 }, NOW)).toBeNull();
});
