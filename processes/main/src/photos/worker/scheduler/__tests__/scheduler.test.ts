import { ReportedAttention } from '#photos/worker/on-screen/screen-contents';
import { DroppedError } from '#photos/worker/scheduler/dropped-error';
import { LIMITS, MAX_WAITING, type Priority } from '#photos/worker/scheduler/limits';
import { Scheduler } from '#photos/worker/scheduler/scheduler';
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

/** Work that takes `ms`, as the timers tell it. */
function pause(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

test('work nothing priority any more is dropped before it starts', async () => {
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
  jobs.reschedule();
  await expect(left).rejects.toBeInstanceOf(DroppedError);
  for (const { finish } of blockers) {
    finish();
  }
  await setImmediate();
  expect(started).not.toContain('left');
});

test('work shared with someone who still priority it is kept', async () => {
  const jobs = scheduler();
  const work = vi.fn(() => Promise.resolve('made'));
  const gone = jobs.run('thumbnail', 'a', () => null, work);
  const kept = jobs.run('thumbnail', 'a', () => 'ahead', work);
  await expect(Promise.all([gone, kept])).resolves.toEqual(['made', 'made']);
});

test('joining a job that priority it more puts it ahead of what it waited behind', async () => {
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
  jobs.run('folder', 'listed', () => 'visible', listed.work).catch(() => null);
  await setImmediate();
  expect(started).toEqual([...running.map((_job, index) => `walk ${index}`), 'listed']);
});

test('a thumbnail scrolled into view overtakes those queued ahead of the scroll, and one scrolled out is dropped', async () => {
  const jobs = scheduler();
  const started: string[] = [];
  const attention = new ReportedAttention();
  const show = (shown: string[]) => {
    attention.update({ foldersToRead: [], shown, views: [] });
    jobs.reschedule();
  };
  let plan = 1;
  const ahead = (name: string, of: number) => {
    const thumbnail = gated(started, name);
    const result = jobs.run(
      'thumbnail',
      name,
      () => (plan === of ? 'ahead' : null),
      thumbnail.work,
    );
    return { ...thumbnail, result };
  };
  const visible = (name: string) => {
    const thumbnail = gated(started, name);
    const result = jobs.run('thumbnail', name, attention.entry(name), thumbnail.work);
    return { ...thumbnail, result };
  };
  // Thumbnails ahead of the scroll fill as many of the thumbnail slots as they may, and those on
  // show the rest.
  const others = Array.from(
    { length: LIMITS.thumbnail.visible - LIMITS.thumbnail.ahead - 1 },
    (_job, index) => `other ${index}`,
  );
  show(['shown', 'gone', ...others]);
  const running = [
    visible('shown'),
    ...Array.from({ length: LIMITS.thumbnail.ahead }, (_job, index) => ahead(`ahead ${index}`, 1)),
    ...others.map((name) => visible(name)),
  ];
  await setImmediate();
  expect(started).toHaveLength(LIMITS.thumbnail.visible);
  const queued = [ahead('queued 0', 1), ahead('queued 1', 1), ahead('queued 2', 1)];
  const gone = visible('gone');
  await setImmediate();
  expect(started).toHaveLength(LIMITS.thumbnail.visible);
  // Scrolled on: `gone` leaves the view and `new` comes into it, behind the queued ones.
  show(['shown', 'new', ...others]);
  const next = visible('new');
  await expect(gone.result).rejects.toBeInstanceOf(DroppedError);
  running[1]?.finish();
  await setImmediate();
  expect(started.slice(LIMITS.thumbnail.visible)).toEqual(['new']);
  // A new plan ahead of the scroll drops what the last one queued.
  plan = 2;
  jobs.reschedule();
  for (const { result } of queued) {
    await expect(result).rejects.toBeInstanceOf(DroppedError);
  }
  for (const { finish } of [...running, next]) {
    finish();
  }
  await setImmediate();
  expect(started).not.toContain('gone');
  expect(started.filter((name) => name.startsWith('queued'))).toEqual([]);
});

test('a kind with too many waiting jobs turns new work away', async () => {
  const jobs = scheduler();
  for (let index = 0; index < LIMITS.tile.visible; index += 1) {
    jobs.run('tile', `busy ${index}`, () => 'visible', gated([], 'busy').work).catch(() => null);
  }
  for (let index = 0; index < (MAX_WAITING.tile ?? 0); index += 1) {
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
  jobs.reschedule();
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

test('a thumbnail on show starts at once beside a re-check that fills its slots', async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const jobs = scheduler();
  // The launch's check of the library: an `lstat` of 30 ms a folder, 16 handed over at a time
  // as a walk does, beside photos' details read in the background.
  let next = 0;
  let checking = 0;
  const check = async () => {
    checking += 1;
    await pause(30);
    checking -= 1;
  };
  const stamp = (): Promise<unknown> => {
    next += 1;
    return jobs.run('folder', `stamp ${next}`, () => 'background', check).then(stamp);
  };
  for (let index = 0; index < 16; index += 1) {
    stamp().catch(() => null);
    jobs
      .run(
        'details',
        `read ${index}`,
        () => 'background',
        () => pause(200),
      )
      .catch(() => null);
  }
  await vi.advanceTimersByTimeAsync(95);
  expect(checking).toBe(LIMITS.folder.background);
  const asked = Date.now();
  const startedAt: number[] = [];
  for (let index = 0; index < LIMITS.thumbnail.visible; index += 1) {
    jobs
      .run(
        'thumbnail',
        `shown ${index}`,
        () => 'visible',
        () => {
          startedAt.push(Date.now());
          return pause(300);
        },
      )
      .catch(() => null);
  }
  await vi.advanceTimersByTimeAsync(0);
  expect(startedAt).toEqual(Array.from({ length: LIMITS.thumbnail.visible }, () => asked));
});
