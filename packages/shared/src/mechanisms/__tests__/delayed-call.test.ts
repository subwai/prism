import { DelayedCall } from '#mechanisms/delayed-call';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('requests made before the call happens join it', () => {
  const run = vi.fn();
  const call = new DelayedCall(run, 250);
  call.request();
  vi.advanceTimersByTime(200);
  call.request();
  vi.advanceTimersByTime(50);
  expect(run).toHaveBeenCalledTimes(1);
  call.request();
  vi.advanceTimersByTime(249);
  expect(run).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(run).toHaveBeenCalledTimes(2);
});

test('a cancelled call does not happen, and a later request asks again', () => {
  const run = vi.fn();
  const call = new DelayedCall(run, 250);
  call.request();
  call.cancel();
  vi.advanceTimersByTime(1000);
  expect(run).not.toHaveBeenCalled();
  call.request();
  vi.advanceTimersByTime(250);
  expect(run).toHaveBeenCalledTimes(1);
});
