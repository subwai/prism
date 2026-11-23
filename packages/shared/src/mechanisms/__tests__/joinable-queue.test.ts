import { JoinableQueue } from '#mechanisms/joinable-queue';
import { expect, test, vi } from 'vitest';

/** A queue whose work for each key settles when the test says, picking keys by `order`. */
function queueOf(order: string[]) {
  const started: string[] = [];
  const finishers = new Map<string, (result: string) => void>();
  const busy = vi.fn();
  const queue = new JoinableQueue<string, string | null>({
    busy,
    pickNext: (isWaiting) => order.find((key) => isWaiting(key)) ?? null,
    work: (key) => {
      started.push(key);
      const { promise, resolve } = Promise.withResolvers<string>();
      finishers.set(key, resolve);
      return promise;
    },
  });
  const finish = async (key: string) => {
    finishers.get(key)?.(`${key} done`);
    await vi.waitFor(() => expect(queue.isAsked(key)).toBe(false));
  };
  return { busy, finish, queue, started };
}

test('works one key at a time, in the order picked, and a key asked twice waits once', async () => {
  const { busy, finish, queue, started } = queueOf(['c', 'b', 'a']);
  const first = queue.want('a');
  const second = queue.want('b');
  const third = queue.want('c');
  expect(queue.want('b')).toBe(second);
  expect(started).toEqual(['a']);
  expect(busy.mock.calls).toEqual([[true]]);
  await finish('a');
  // `c` was used more recently than `b`, so it goes first.
  expect(started).toEqual(['a', 'c']);
  await finish('c');
  await finish('b');
  await expect(Promise.all([first, second, third])).resolves.toEqual([
    'a done',
    'b done',
    'c done',
  ]);
  expect(started).toEqual(['a', 'c', 'b']);
  expect(busy.mock.calls).toEqual([[true], [false]]);
});

test('a key dropped while it waits is answered at once, and never worked on', async () => {
  const { finish, queue, started } = queueOf(['a', 'b']);
  queue.want('a').catch(() => null);
  const second = queue.want('b');
  queue.drop('b', null);
  await expect(second).resolves.toBeNull();
  await finish('a');
  expect(started).toEqual(['a']);
});
