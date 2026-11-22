import { FOCUSED_LIMITS, LIMITS } from '#photos/worker/scheduler/limits';
import { Scheduler } from '#photos/worker/scheduler/scheduler';
import { setImmediate } from 'node:timers/promises';
import { expect, onTestFinished, test } from 'vitest';

test('a change of focus starts more photos’ details at once, or lets fewer start', async () => {
  const controller = new AbortController();
  onTestFinished(() => controller.abort());
  const jobs = new Scheduler(controller.signal);
  const started: number[] = [];
  const reads = Array.from({ length: 16 }, () => Promise.withResolvers<null>());
  for (const [index, read] of reads.entries()) {
    jobs
      .run(
        'details',
        `read ${index}`,
        () => 'background',
        () => {
          started.push(index);
          return read.promise;
        },
      )
      .catch(() => null);
  }
  await setImmediate();
  expect(started).toHaveLength(LIMITS.details.background);
  jobs.focus(true);
  await setImmediate();
  expect(started).toHaveLength(FOCUSED_LIMITS.details.background);
  // Out of focus, the reads under way go on, and none starts until fewer than four run.
  jobs.focus(false);
  for (const read of reads.slice(0, 8)) {
    read.resolve(null);
  }
  await setImmediate();
  expect(started).toHaveLength(FOCUSED_LIMITS.details.background);
  reads[8]?.resolve(null);
  await setImmediate();
  expect(started).toHaveLength(FOCUSED_LIMITS.details.background + 1);
});
