import { DroppedError } from '#photos/worker/dropped-error';
import { Scheduler } from '#photos/worker/scheduler';
import { CAPACITY, LIMITS, type Priority } from '#photos/worker/scheduling';
import { setImmediate } from 'node:timers/promises';
import { expect, onTestFinished, test, vi } from 'vitest';

function scheduler() {
  const controller = new AbortController();
  onTestFinished(() => controller.abort());
  return new Scheduler(controller.signal);
}

/** Work that runs until `finish` is called, noting that it started. */
function gated(started: string[], name: string) {
  const gate = Promise.withResolvers<string>();
  return {
    finish: () => gate.resolve(name),
    work: () => {
      started.push(name);
      return gate.promise;
    },
  };
}

test('work of the same key is shared among everyone asking for it', async () => {
  const work = vi.fn(() => Promise.resolve(42));
  const jobs = scheduler();
  const first = jobs.run('thumbnail', 'a', () => 'visible', work);
  const second = jobs.run('thumbnail', 'a', () => 'ahead', work);
  await expect(Promise.all([first, second])).resolves.toEqual([42, 42]);
  expect(work).toHaveBeenCalledOnce();
});

test('what the window shows starts before older work for the background', async () => {
  const jobs = scheduler();
  const started: string[] = [];
  const limit = LIMITS.tile.visible;
  const running = Array.from({ length: limit }, (_job, index) => gated(started, `busy ${index}`));
  for (const [index, { work }] of running.entries()) {
    jobs.run('tile', `busy ${index}`, () => 'visible', work).catch(() => null);
  }
  const later = gated(started, 'later');
  const background = gated(started, 'background');
  const shown = gated(started, 'shown');
  let priority: Priority = 'background';
  jobs.run('tile', 'background', () => 'background', background.work).catch(() => null);
  jobs.run('tile', 'later', () => priority, later.work).catch(() => null);
  jobs.run('tile', 'shown', () => 'visible', shown.work).catch(() => null);
  await setImmediate();
  expect(started).toHaveLength(limit);
  // Scrolled into view meanwhile.
  priority = 'visible';
  running[0]?.finish();
  running[1]?.finish();
  await setImmediate();
  expect(started.slice(limit)).toEqual(['later', 'shown']);
});

test('work nothing wants any more is dropped before it starts', async () => {
  const jobs = scheduler();
  const started: string[] = [];
  const blockers = Array.from({ length: LIMITS.tile.visible }, (_job, index) =>
    gated(started, `busy ${index}`),
  );
  for (const [index, { work }] of blockers.entries()) {
    jobs.run('tile', `busy ${index}`, () => 'visible', work).catch(() => null);
  }
  let wanted = true;
  const left = jobs.run(
    'tile',
    'left',
    () => (wanted ? 'visible' : null),
    () => {
      started.push('left');
      return Promise.resolve();
    },
  );
  wanted = false;
  jobs.reconsider();
  await expect(left).rejects.toBeInstanceOf(DroppedError);
  for (const { finish } of blockers) {
    finish();
  }
  await setImmediate();
  expect(started).not.toContain('left');
});

test('work shared with someone who still wants it is kept', async () => {
  const jobs = scheduler();
  const work = vi.fn(() => Promise.resolve('made'));
  const gone = jobs.run('thumbnail', 'a', () => null, work);
  const kept = jobs.run('thumbnail', 'a', () => 'ahead', work);
  await expect(Promise.all([gone, kept])).resolves.toEqual(['made', 'made']);
});

test('raising a job puts it ahead of what it waited behind', async () => {
  const jobs = scheduler();
  const started: string[] = [];
  const running = Array.from({ length: LIMITS.folder.background }, (_job, index) =>
    gated(started, `walk ${index}`),
  );
  for (const [index, { work }] of running.entries()) {
    jobs.run('folder', `walk ${index}`, () => 'background', work).catch(() => null);
  }
  const listed = gated(started, 'listed');
  jobs.run('folder', 'listed', () => 'background', listed.work).catch(() => null);
  await setImmediate();
  expect(started).not.toContain('listed');
  expect(jobs.raise('folder', 'listed', () => 'visible')).toBe(true);
  await setImmediate();
  expect(started).toContain('listed');
  expect(jobs.raise('folder', 'nothing', () => 'visible')).toBe(false);
});

test('a full lane turns new work away', async () => {
  const jobs = scheduler();
  for (let index = 0; index < LIMITS.tile.visible; index += 1) {
    jobs.run('tile', `busy ${index}`, () => 'visible', gated([], 'busy').work).catch(() => null);
  }
  for (let index = 0; index < (CAPACITY.tile ?? 0); index += 1) {
    jobs
      .run(
        'tile',
        `waiting ${index}`,
        () => 'visible',
        () => Promise.resolve(),
      )
      .catch(() => null);
  }
  await expect(
    jobs.run(
      'tile',
      'more',
      () => 'visible',
      () => Promise.resolve(),
    ),
  ).rejects.toThrow('Work queue is full');
});

test('closing drops what waits, and turns new work away', async () => {
  const controller = new AbortController();
  const jobs = new Scheduler(controller.signal);
  const blockers = Array.from({ length: LIMITS.tile.visible }, (_job, index) =>
    jobs.run(
      'tile',
      `busy ${index}`,
      () => 'visible',
      () => Promise.withResolvers<never>().promise,
    ),
  );
  const waiting = jobs.run(
    'tile',
    'waiting',
    () => 'visible',
    () => Promise.resolve(),
  );
  await setImmediate();
  controller.abort();
  jobs.reconsider();
  await expect(waiting).rejects.toThrow();
  await expect(
    jobs.run(
      'tile',
      'new',
      () => 'visible',
      () => Promise.resolve(),
    ),
  ).rejects.toThrow();
  expect(blockers).toHaveLength(LIMITS.tile.visible);
});
