import { RisingCount } from '#mechanisms/rising-count';
import { expect, test } from 'vitest';

test('a wait settles once the count reaches its number, and never goes back', async () => {
  const count = new RisingCount();
  const settled: number[] = [];
  const waits = [1, 3].map((target) => count.reached(target).then(() => settled.push(target)));
  count.raise(2);
  count.raise(1);
  await Promise.resolve();
  expect(count.value).toBe(2);
  expect(settled).toEqual([1]);
  count.raise(3);
  await Promise.all(waits);
  expect(settled).toEqual([1, 3]);
  await expect(count.reached(0)).resolves.toBeUndefined();
});
