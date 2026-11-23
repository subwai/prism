import { runAFewAtATime } from '#mechanisms/run-a-few-at-a-time';
import { expect, test } from 'vitest';

async function settle() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

test('runs at most the limit at once, in order, and takes up items added meanwhile', async () => {
  const items = [1, 2, 3];
  const finishers = new Map<number, () => void>();
  const started: number[] = [];
  let next = 0;
  const done = runAFewAtATime({
    limit: 2,
    run: (item) =>
      new Promise<void>((resolve) => {
        started.push(item);
        finishers.set(item, resolve);
      }),
    takeNext: () => {
      next += 1;
      return items[next - 1] ?? null;
    },
  });
  await settle();
  expect(started).toEqual([1, 2]);
  finishers.get(1)?.();
  await settle();
  expect(started).toEqual([1, 2, 3]);
  // Added while 2 and 3 still run, as a walk adds the folders it finds.
  next = items.length;
  items.push(4);
  finishers.get(2)?.();
  await settle();
  expect(started).toEqual([1, 2, 3, 4]);
  finishers.get(3)?.();
  finishers.get(4)?.();
  await done;
});

test('stops taking items once takeNext returns undefined, and waits for those running', async () => {
  let stopped = false;
  let count = 0;
  let finished = 0;
  await runAFewAtATime({
    limit: 3,
    run: async (item: number) => {
      await settle();
      finished += item;
      stopped = true;
    },
    takeNext: () => {
      if (stopped) {
        return null;
      }
      count += 1;
      return 1;
    },
  });
  expect(count).toBe(3);
  expect(finished).toBe(3);
});
