import { RequestQueue } from '#data/request-queue';
import { expect, test, vi } from 'vitest';

test('keeps active work within the limit', async () => {
  const queue = new RequestQueue(1);
  const first = Promise.withResolvers<number>();
  const second = vi.fn(() => Promise.resolve(2));
  const results = [queue.run('a', () => first.promise), queue.run('b', second)];
  expect(second).not.toHaveBeenCalled();
  first.resolve(1);
  await expect(Promise.all(results)).resolves.toEqual([1, 2]);
});

test('parks work nobody wants by its turn, and runs it once it is wanted', async () => {
  const wanted = new Set(['visible']);
  const queue = new RequestQueue(1, (key) => wanted.has(key));
  const hidden = vi.fn(() => Promise.resolve('hidden'));
  const result = queue.run('hidden', hidden);
  await expect(queue.run('visible', () => Promise.resolve('visible'))).resolves.toBe('visible');
  expect(hidden).not.toHaveBeenCalled();
  wanted.add('hidden');
  queue.wake('hidden');
  await expect(result).resolves.toBe('hidden');
});

test('drops parked work whose signal aborts, so waking it runs nothing', async () => {
  const queue = new RequestQueue(1, () => false);
  const controller = new AbortController();
  const hidden = vi.fn(() => Promise.resolve('hidden'));
  const result = queue.run('hidden', hidden, controller.signal);
  controller.abort(new Error('Nothing shows it.'));
  await expect(result).rejects.toThrow('Nothing shows it.');
  queue.wake('hidden');
  expect(hidden).not.toHaveBeenCalled();
});

test('drops waiting work whose signal aborts, and runs what comes after it', async () => {
  const queue = new RequestQueue(1);
  const first = Promise.withResolvers<string>();
  const controller = new AbortController();
  const dropped = vi.fn(() => Promise.resolve('dropped'));
  const running = queue.run('first', () => first.promise);
  const waiting = queue.run('second', dropped, controller.signal);
  const after = queue.run('third', () => Promise.resolve('third'));
  controller.abort();
  await expect(waiting).rejects.toThrow();
  first.resolve('first');
  await expect(Promise.all([running, after])).resolves.toEqual(['first', 'third']);
  expect(dropped).not.toHaveBeenCalled();
});

test('lets work that has started finish, whatever its signal does', async () => {
  const queue = new RequestQueue(1);
  const controller = new AbortController();
  const result = queue.run('started', () => Promise.resolve('done'), controller.signal);
  controller.abort();
  await expect(result).resolves.toBe('done');
});
