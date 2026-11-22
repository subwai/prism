import { msLeft, timeLeft, withSample } from '#data/activity/details-estimate';
import { expect, test } from 'vitest';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

test('the time left is the photos left at the rate read over the last five minutes', () => {
  let samples = [{ ms: 0, read: 0 }];
  // Too short a time to go on.
  samples = withSample(samples, { ms: 10 * SECOND_MS, read: 200 });
  expect(msLeft(samples, 1000)).toBeNull();
  // 20 a second.
  samples = withSample(samples, { ms: MINUTE_MS, read: 1200 });
  expect(msLeft(samples, 1200)).toBe(MINUTE_MS);
  // A burst moves it a little, as the rate is over all five minutes.
  samples = withSample(samples, { ms: 2 * MINUTE_MS, read: 2400 });
  samples = withSample(samples, { ms: 2 * MINUTE_MS + SECOND_MS, read: 2600 });
  expect(msLeft(samples, 2600)).toBeCloseTo(2 * MINUTE_MS + SECOND_MS);
  // Samples older than five minutes no longer count: here, a stall then reading again.
  samples = withSample(samples, { ms: 8 * MINUTE_MS, read: 2600 });
  samples = withSample(samples, { ms: 9 * MINUTE_MS, read: 3200 });
  expect(samples.map(({ ms }) => ms)).toEqual([8 * MINUTE_MS, 9 * MINUTE_MS]);
  expect(msLeft(samples, 600)).toBe(MINUTE_MS);
});

test('no time left while nothing is read, or photos read went down', () => {
  expect(msLeft([], 10)).toBeNull();
  expect(
    msLeft(
      [
        { ms: 0, read: 50 },
        { ms: MINUTE_MS, read: 50 },
      ],
      10,
    ),
  ).toBeNull();
  expect(
    msLeft(
      [
        { ms: 0, read: 50 },
        { ms: MINUTE_MS, read: 10 },
      ],
      10,
    ),
  ).toBeNull();
});

test('the time left reads in the largest unit that fits', () => {
  expect(timeLeft(30 * SECOND_MS)).toBe('under a minute left');
  expect(timeLeft(14 * MINUTE_MS)).toBe('about 14 min left');
  expect(timeLeft(23 * 60 * MINUTE_MS)).toBe('about 23 h left');
  expect(timeLeft(4 * 24 * 60 * MINUTE_MS)).toBe('about 4 days left');
});
