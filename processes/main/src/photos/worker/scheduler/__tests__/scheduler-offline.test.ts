import { Scheduler } from '#photos/worker/scheduler/scheduler';
import { setImmediate } from 'node:timers/promises';
import { expect, onTestFinished, test, vi } from 'vitest';

/** A scheduler whose disk is offline once `offline` says so, which `lost` asks. */
function scheduler() {
  const controller = new AbortController();
  onTestFinished(() => controller.abort());
  const disk = { offline: false };
  const jobs = new Scheduler(controller.signal, () => Promise.resolve(disk.offline));
  return { disk, jobs };
}

test('nothing starts while the disk is offline, and what waited starts once it is back', async () => {
  const { jobs } = scheduler();
  const work = vi.fn(() => Promise.resolve('read'));
  jobs.pause(true);
  const read = jobs.run('folder', 'a', () => 'visible', work);
  await setImmediate();
  expect(work).not.toHaveBeenCalled();
  expect(jobs.jobs().folder).toEqual({ running: 0, waiting: 1 });
  jobs.pause(false);
  await expect(read).resolves.toBe('read');
});

test('work that fails as the disk goes offline waits for it, rather than failing', async () => {
  const { disk, jobs } = scheduler();
  const work = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }))
    .mockResolvedValue('read');
  const read = jobs.run(
    'thumbnail',
    'a',
    () => 'visible',
    () => {
      // The disk goes as it is read, which pauses the scheduler.
      disk.offline = true;
      jobs.pause(true);
      return work();
    },
  );
  await vi.waitFor(() => expect(work).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(jobs.jobs().thumbnail).toEqual({ running: 0, waiting: 1 }));
  disk.offline = false;
  jobs.pause(false);
  await expect(read).resolves.toBe('read');
});

test('work that fails while the disk is there fails, and what waits for an offline disk can be dropped', async () => {
  const { jobs } = scheduler();
  await expect(
    jobs.run(
      'details',
      'a',
      () => 'background',
      () => Promise.reject(new Error('corrupt')),
    ),
  ).rejects.toThrow('corrupt');
  jobs.pause(true);
  let wanted = true;
  const waiting = jobs.run('details', 'b', () => (wanted ? 'background' : null), vi.fn());
  wanted = false;
  jobs.reconsider();
  await expect(waiting).rejects.toThrow('Nothing wants this any more.');
});
