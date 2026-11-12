import { fakeTrashAPI } from '#data/__tests__/fixtures';
import { TrashRuns } from '#data/trash-runs';
import { noTrashChoices, type TrashProgress, type TrashRunResult } from '@prism/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const RAN: TrashRunResult = {
  destination: 'system',
  moved: 0,
  runId: 'run',
  skipped: 0,
  trashed: 2,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Runs to the Trash whose worker answers every run with `result`. */
function runsAnswering(result: TrashRunResult | { error: string }) {
  const trash = fakeTrashAPI();
  trash.trashView.mockResolvedValue(result);
  return { runs: new TrashRuns(trash), trash };
}

test('what a run did shows for twenty seconds, and longer while held', async () => {
  const { runs } = runsAnswering(RAN);

  await runs.run('view', 1, noTrashChoices(), 5);
  expect(runs.getSnapshot().shown).toEqual({ items: 5, result: RAN, undone: null });
  runs.hold(true);
  vi.advanceTimersByTime(60_000);
  expect(runs.getSnapshot().shown).not.toBeNull();

  runs.hold(false);
  vi.advanceTimersByTime(19_999);
  expect(runs.getSnapshot().shown).not.toBeNull();
  vi.advanceTimersByTime(1);
  expect(runs.getSnapshot().shown).toBeNull();
});

test('a run that could not start shows nothing, as the sheet says why', async () => {
  const { runs } = runsAnswering({ error: 'The folder changed since this was planned.' });

  await expect(runs.run('view', 1, noTrashChoices(), 5)).resolves.toEqual({
    error: 'The folder changed since this was planned.',
  });
  expect(runs.getSnapshot()).toEqual({ progress: null, shown: null });
});

test('progress is heard only while a run is under way', async () => {
  const { runs, trash } = runsAnswering(RAN);
  const heard: (TrashProgress | null)[] = [];
  runs.subscribe(() => heard.push(runs.getSnapshot().progress));
  trash.trashView.mockImplementation(() => {
    const [[listener]] = trash.onTrashProgress.mock.calls as [[(progress: TrashProgress) => void]];
    listener({ done: 1, total: 2 });
    return Promise.resolve(RAN);
  });

  await runs.run('view', 1, noTrashChoices(), 5);

  expect(heard).toContainEqual({ done: 1, total: 2 });
  expect(runs.getSnapshot().progress).toBeNull();
  const [stopHearing] = trash.onTrashProgress.mock.results.map(({ value }) => value);
  expect(stopHearing).toHaveBeenCalled();
});

test('Undo shows what came back, for twenty seconds more', async () => {
  const { runs, trash } = runsAnswering(RAN);
  trash.undoTrash.mockResolvedValue({ renamed: [], restored: 2 });
  await runs.run('view', 1, noTrashChoices(), 5);
  vi.advanceTimersByTime(19_000);

  await runs.undo('run');

  expect(trash.undoTrash).toHaveBeenCalledWith('run');
  expect(runs.getSnapshot().shown?.undone).toEqual({ renamed: [], restored: 2 });
  vi.advanceTimersByTime(19_000);
  expect(runs.getSnapshot().shown).not.toBeNull();
  vi.advanceTimersByTime(1000);
  expect(runs.getSnapshot().shown).toBeNull();
});
