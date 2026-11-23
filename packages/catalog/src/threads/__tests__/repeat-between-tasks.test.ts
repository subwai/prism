import { RepeatBetweenTasks } from '#threads/repeat-between-tasks';
import { setImmediate as nextTask } from 'node:timers/promises';
import { expect, test } from 'vitest';

test('each step waits for the work already waiting, until the step says it is done', async () => {
  const order: string[] = [];
  let steps = 0;
  const repeat = new RepeatBetweenTasks(() => {
    steps += 1;
    order.push(`step ${steps}`);
    return steps < 3;
  });
  repeat.start();
  order.push('waiting work');
  for (let task = 0; task < 5; task += 1) {
    await nextTask();
  }
  expect(order).toEqual(['waiting work', 'step 1', 'step 2', 'step 3']);
});

test('a stopped repeat runs no more steps', async () => {
  let steps = 0;
  const repeat = new RepeatBetweenTasks(() => {
    steps += 1;
    return true;
  });
  repeat.start();
  repeat.stop();
  await nextTask();
  await nextTask();
  expect(steps).toBe(0);
});
