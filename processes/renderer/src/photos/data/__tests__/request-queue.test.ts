import { RequestQueue } from '#photos/data/request-queue';
import { expect, test, vi } from 'vitest';

test('removes cancelled work before it can reach IPC', async () => {
  const queue = new RequestQueue(1);
  const running = Promise.withResolvers<number>();
  const first = queue.run(() => running.promise, new AbortController().signal);
  const controller = new AbortController();
  const work = vi.fn(() => Promise.resolve(2));
  const second = queue.run(work, controller.signal);
  controller.abort();
  await expect(second).rejects.toMatchObject({ name: 'AbortError' });
  running.resolve(1);
  await expect(first).resolves.toBe(1);
  expect(work).not.toHaveBeenCalled();
});

test('keeps active work within the limit while native cancellation finishes', async () => {
  const queue = new RequestQueue(1);
  const nativeWork = Promise.withResolvers<number>();
  const controller = new AbortController();
  const first = queue.run(() => nativeWork.promise, controller.signal);
  const secondWork = vi.fn(() => Promise.resolve(2));
  const second = queue.run(secondWork, new AbortController().signal);
  controller.abort();
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  expect(secondWork).not.toHaveBeenCalled();
  nativeWork.resolve(1);
  await expect(second).resolves.toBe(2);
});
