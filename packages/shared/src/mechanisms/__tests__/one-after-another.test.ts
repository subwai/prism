import { OneAfterAnother } from '#mechanisms/one-after-another';
import { OneAfterAnotherPerKey } from '#mechanisms/one-after-another-per-key';
import { expect, test } from 'vitest';

/** A task that notes when it starts, and settles when its test says so. */
function task(started: string[], name: string) {
  const { promise, reject, resolve } = Promise.withResolvers<string>();
  return {
    fail: () => reject(new Error(name)),
    finish: () => resolve(name),
    run: () => {
      started.push(name);
      return promise;
    },
  };
}

async function settle() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

test('each task starts once the one before it has settled, even if it failed', async () => {
  const started: string[] = [];
  const line = new OneAfterAnother();
  const first = task(started, 'first');
  const second = task(started, 'second');
  const firstResult = line.run(first.run);
  const secondResult = line.run(second.run);
  await settle();
  expect(started).toEqual(['first']);
  first.fail();
  await expect(firstResult).rejects.toThrow('first');
  await settle();
  expect(started).toEqual(['first', 'second']);
  second.finish();
  await expect(secondResult).resolves.toBe('second');
});

test('done settles once every task given so far has', async () => {
  const line = new OneAfterAnother();
  const only = task([], 'only');
  line.run(only.run).catch(() => null);
  let isDone = false;
  line
    .done()
    .then(() => {
      isDone = true;
    })
    .catch(() => null);
  await settle();
  expect(isDone).toBe(false);
  only.fail();
  await settle();
  expect(isDone).toBe(true);
});

test('tasks of one key wait for each other, but not for other keys', async () => {
  const started: string[] = [];
  const lines = new OneAfterAnotherPerKey<string>();
  const a1 = task(started, 'a1');
  const a2 = task(started, 'a2');
  const b1 = task(started, 'b1');
  const results = [lines.run('a', a1.run), lines.run('a', a2.run), lines.run('b', b1.run)];
  await settle();
  expect(started).toEqual(['a1', 'b1']);
  a1.finish();
  await settle();
  expect(started).toEqual(['a1', 'b1', 'a2']);
  a2.finish();
  b1.finish();
  await expect(Promise.all(results)).resolves.toEqual(['a1', 'a2', 'b1']);
});
