import { fakeTrashAPI } from '#data/__tests__/fixtures';
import { TrashRuns } from '#data/trash/runs';
import { defaultTrashChoices, type TrashProgress, type TrashRunResult } from '@prism/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const RUN_REQUEST = {
  choices: defaultTrashChoices(),
  destination: 'system',
  entries: 5,
  version: 1,
  viewId: 'view',
} as const;

const RAN: TrashRunResult = {
  destination: 'system',
  kind: 'ran',
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
function runsAnswering(result: TrashRunResult) {
  const trash = fakeTrashAPI();
  trash.trashView.mockResolvedValue(result);
  return { runs: new TrashRuns(trash), trash };
}

test('what a run did shows for twenty seconds, and longer while held', async () => {
  const { runs } = runsAnswering(RAN);

  await runs.run(RUN_REQUEST);
  expect(runs.getSnapshot().shown).toEqual({ entries: 5, result: RAN, undone: null });
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
  const { runs } = runsAnswering({
    error: 'The folder changed since this was planned.',
    kind: 'failed',
  });

  await expect(runs.run(RUN_REQUEST)).resolves.toEqual({
    error: 'The folder changed since this was planned.',
    kind: 'failed',
  });
  expect(runs.getSnapshot()).toEqual({ progress: null, shown: null, undoable: null });
});

test('progress is reported only while a run is under way', async () => {
  const { runs, trash } = runsAnswering(RAN);
  const progressSeen: (TrashProgress | null)[] = [];
  runs.subscribe(() => progressSeen.push(runs.getSnapshot().progress));
  trash.trashView.mockImplementation(() => {
    const [[listener]] = trash.onTrashProgress.mock.calls as [[(progress: TrashProgress) => void]];
    listener({ done: 1, total: 2 });
    return Promise.resolve(RAN);
  });

  await runs.run(RUN_REQUEST);

  expect(progressSeen).toContainEqual({ done: 1, total: 2 });
  expect(runs.getSnapshot().progress).toBeNull();
  const [stopListening] = trash.onTrashProgress.mock.results.map(({ value }) => value);
  expect(stopListening).toHaveBeenCalled();
});

test('Undo shows what came back, for twenty seconds more', async () => {
  const { runs, trash } = runsAnswering(RAN);
  trash.undoTrash.mockResolvedValue({ kind: 'undone', renamed: [], restored: 2 });
  await runs.run(RUN_REQUEST);
  vi.advanceTimersByTime(19_000);

  await runs.undo('run');

  expect(trash.undoTrash).toHaveBeenCalledWith('run');
  expect(runs.getSnapshot().shown?.undone).toEqual({ kind: 'undone', renamed: [], restored: 2 });
  vi.advanceTimersByTime(19_000);
  expect(runs.getSnapshot().shown).not.toBeNull();
  vi.advanceTimersByTime(1000);
  expect(runs.getSnapshot().shown).toBeNull();
});

test('the last run can be undone after it no longer shows, and only once', async () => {
  const { runs, trash } = runsAnswering(RAN);
  trash.undoTrash.mockResolvedValue({ kind: 'undone', renamed: [], restored: 2 });
  await runs.run(RUN_REQUEST);
  vi.advanceTimersByTime(20_000);
  expect(runs.getSnapshot()).toMatchObject({ shown: null, undoable: { result: RAN } });

  await runs.undo('run');

  expect(runs.getSnapshot()).toMatchObject({
    shown: { entries: 5, undone: { restored: 2 } },
    undoable: null,
  });
});
