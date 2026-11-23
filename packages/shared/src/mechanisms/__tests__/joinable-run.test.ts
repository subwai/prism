import { JoinableRun } from '#mechanisms/joinable-run';
import { expect, test, vi } from 'vitest';

test('a caller joins the run under way, and the next one after it starts another', async () => {
  const runs = [Promise.withResolvers<number>(), Promise.withResolvers<number>()];
  const work = vi.fn(() => runs[work.mock.calls.length - 1]?.promise ?? Promise.resolve(0));
  const run = new JoinableRun(work);
  const first = run.run();
  const second = run.run();
  expect(second).toBe(first);
  expect(run.underWay).toBe(first);
  expect(work).toHaveBeenCalledTimes(1);
  runs[0]?.resolve(1);
  await expect(second).resolves.toBe(1);
  expect(run.underWay).toBeUndefined();
  const third = run.run();
  expect(work).toHaveBeenCalledTimes(2);
  runs[1]?.resolve(2);
  await expect(third).resolves.toBe(2);
});

test('a run that fails is not joined by later callers', async () => {
  const work = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce('worked');
  const run = new JoinableRun<string>(work);
  await expect(run.run()).rejects.toThrow('failed');
  await expect(run.run()).resolves.toBe('worked');
});
