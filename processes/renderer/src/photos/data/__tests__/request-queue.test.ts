import { RequestQueue } from '#photos/data/request-queue';
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
