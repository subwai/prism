import { LIMITS } from '#photos/worker/scheduler/limits';
import {
  ALWAYS_VISIBLE,
  type CurrentPriority,
  Scheduler,
} from '#photos/worker/scheduler/scheduler';
import { expect, onTestFinished, test, vi } from 'vitest';

// The limits of a Mac with eight cores, which decodes four thumbnails at once.
vi.mock(import('@prism/media'), async (original) => ({
  ...(await original()),
  THUMBNAIL_CONCURRENCY: 4,
  THUMBNAIL_READS: 16,
}));

function scheduler() {
  const controller = new AbortController();
  onTestFinished(() => controller.abort());
  return new Scheduler(controller.signal);
}

function pause(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The decodes under way, and the most at once. */
interface Decodes {
  now: number;
  most: number;
}

/**
 * Makes `count` thumbnails as the window's work does, as a network share takes them: a read of
 * 100–300 ms, then a decode of 20–60 ms in its turn, counted in `decodes`. Resolves with when
 * each was done.
 */
function share(
  jobs: Scheduler,
  decodes: Decodes,
  count: number,
  priority: CurrentPriority,
  name: string,
) {
  const done = Array.from({ length: count }, async (_thumbnail, index) => {
    const key = `${name} ${index}`;
    await jobs.run('thumbnail', key, priority, async (_signal, wanted) => {
      await pause(100 + ((index * 67) % 201));
      await jobs.run(
        'decode',
        key,
        () => wanted() ?? 'ahead',
        async () => {
          decodes.now += 1;
          decodes.most = Math.max(decodes.most, decodes.now);
          await pause(20 + ((index * 29) % 41));
          decodes.now -= 1;
        },
      );
    });
    return Date.now();
  });
  return Promise.all(done);
}

test('a screen of thumbnails from a share is read at once, and decoded a few at a time', async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const jobs = scheduler();
  const asked = Date.now();
  const decodes = { most: 0, now: 0 };
  const shown = share(jobs, decodes, 16, ALWAYS_VISIBLE, 'shown');
  await vi.runAllTimersAsync();
  const done = await shown;
  // Read four at a time, each holding a decode's slot while it read, they took 913 ms.
  expect(Math.max(...done) - asked).toBe(328);
  expect(decodes.most).toBe(LIMITS.decode.visible);
});

test('thumbnails on show are read beside those ahead of the scroll, and decoded first', async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const jobs = scheduler();
  const decodes = { most: 0, now: 0 };
  const aheadOfScroll = share(jobs, decodes, 32, () => 'ahead', 'ahead');
  await vi.advanceTimersByTimeAsync(0);
  const asked = Date.now();
  const shown = share(jobs, decodes, 16, ALWAYS_VISIBLE, 'shown');
  await vi.runAllTimersAsync();
  const done = await shown;
  await aheadOfScroll;
  // Read four at a time, three of them ahead of the scroll, they took 1,058 ms.
  expect(Math.max(...done) - asked).toBe(507);
  expect(decodes.most).toBe(LIMITS.decode.visible);
});
