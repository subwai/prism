import { waitForWorkerStart } from '#photos/main/worker-start';
import type { WorkerMessage } from '#photos/messages';
import { expect, onTestFinished, test, vi } from 'vitest';

const FOLDER = { id: '.', location: 'local', name: 'Pictures' } as const;

function starting() {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  // The worker process as `utilityProcess` gives it, which the tests make speak or stop.
  const worker = {
    on: vi.fn<(event: 'message', listener: (message: WorkerMessage) => void) => void>(),
    once: vi.fn<(event: 'exit', listener: () => void) => void>(),
  };
  const upgrading = vi.fn();
  const folder = waitForWorkerStart(worker, upgrading);
  return {
    exit: () => worker.once.mock.lastCall?.[1](),
    folder,
    tell: (message: WorkerMessage) => worker.on.mock.lastCall?.[1](message),
    upgrading,
  };
}

test('a worker that says nothing is taken to have hung', async () => {
  const { folder } = starting();
  const failed = expect(folder).rejects.toThrow('Photo backend did not start.');
  await vi.advanceTimersByTimeAsync(15_000);
  await failed;
});

test('a worker upgrading the catalog is waited for however long it takes, and says so', async () => {
  const { folder, tell, upgrading } = starting();
  tell({ kind: 'upgrading' });
  expect(upgrading).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(20 * 60_000);
  tell({ folder: FOLDER, kind: 'ready' });
  await expect(folder).resolves.toEqual(FOLDER);
});

test('a worker that stops while it starts fails at once', async () => {
  const { exit, folder, tell, upgrading } = starting();
  tell({ kind: 'upgrading' });
  exit();
  await expect(folder).rejects.toThrow('Photo backend stopped.');
  expect(upgrading).toHaveBeenCalledOnce();
});
