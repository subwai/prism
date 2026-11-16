import { isFullReadDue } from '#photos/worker/library-checks';
import { expect, test } from 'vitest';

const DAY_MS = 24 * 60 * 60 * 1000;

test('a launch reads every folder in full once the last full read is over a week old, or none was', () => {
  const now = 100 * DAY_MS;
  expect(isFullReadDue(null, now)).toBe(true);
  expect(isFullReadDue(now - 8 * DAY_MS, now)).toBe(true);
  expect(isFullReadDue(now - 7 * DAY_MS, now)).toBe(false);
  expect(isFullReadDue(now - DAY_MS, now)).toBe(false);
});
