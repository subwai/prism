import { WorkerBackend } from '#photos/worker/backend';
import { PhotoLibrary } from '#photos/worker/library';
import { deleteForGood, SYSTEM_TRASH } from '#photos/worker/trash-destination';
import { restoredName, runTrashPlan, undoTrashRun } from '#photos/worker/trash-run';
import { emptyFilter, noTrashChoices, type TrashPlan, type ViewState } from '@prism/shared';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';

const NO_COUNTS = { files: 0, folders: 0, photos: 0, size: 0, videos: 0 };

/** A library of `files`, by ID, each holding its own name. */
async function library(files: string[]) {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-trash-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  if (process.platform === 'linux') {
    // The home Trash, here, rather than the one of whoever runs the tests.
    vi.stubEnv('XDG_DATA_HOME', path.join(root, '.data'));
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
  }
  for (const file of files) {
    await mkdir(path.join(root, path.dirname(file)), { recursive: true });
    await writeFile(path.join(root, file), file);
  }
  const opened = await PhotoLibrary.open(root);
  onTestFinished(() => opened.close());
  return opened;
}

function plan(moves: TrashPlan['moves'], targets: string[]): TrashPlan {
  return { groups: [], moves, rescued: NO_COUNTS, targets, totals: NO_COUNTS };
}

/** Runs `of`, and puts back what it moved once the test is done, whatever the test did. */
async function run(photos: PhotoLibrary, of: TrashPlan) {
  const onProgress = vi.fn();
  const outcome = await runTrashPlan(photos, of, SYSTEM_TRASH, onProgress);
  onTestFinished(async () => {
    await undoTrashRun(photos, outcome.run);
  });
  return { ...outcome, onProgress };
}

/** Every file under the library's folder, by ID. */
async function filesOf(photos: PhotoLibrary) {
  const found = await readdir(photos.root, { recursive: true, withFileTypes: true });
  return found
    .filter((entry) => entry.isFile() && !entry.parentPath.includes('.data'))
    .map((entry) => path.relative(photos.root, path.join(entry.parentPath, entry.name)))
    .toSorted();
}

test('rescues move out first, then the rest goes to the Trash, and Undo puts it all back', async () => {
  const photos = await library(['Trips/bad.jpg', 'Trips/good.jpg', 'Trips/good.xmp', 'loose.jpg']);
  const ran = await run(
    photos,
    plan(
      [
        { id: 'Trips/good.jpg', to: '.' },
        { id: 'Trips/good.xmp', to: '.' },
      ],
      ['Trips', 'loose.jpg'],
    ),
  );

  expect(ran.error).toBeUndefined();
  expect(await filesOf(photos)).toEqual(['good.jpg', 'good.xmp']);
  expect(ran.run.moved).toEqual([
    { from: 'Trips/good.jpg', to: 'good.jpg' },
    { from: 'Trips/good.xmp', to: 'good.xmp' },
  ]);
  expect(ran.onProgress.mock.calls).toEqual([[{ done: 1, total: 2 }], [{ done: 2, total: 2 }]]);
  const [trip] = ran.run.trashed;
  await expect(readFile(path.join(trip?.landed ?? '', 'bad.jpg'), 'utf8')).resolves.toBe(
    'Trips/bad.jpg',
  );

  await expect(undoTrashRun(photos, ran.run)).resolves.toEqual({ renamed: [], restored: 4 });
  expect(await filesOf(photos)).toEqual([
    'Trips/bad.jpg',
    'Trips/good.jpg',
    'Trips/good.xmp',
    'loose.jpg',
  ]);
});

test('entries gone since the plan was made are left out', async () => {
  const photos = await library(['a.jpg']);
  const ran = await run(photos, plan([{ id: 'moved.jpg', to: '.' }], ['gone.jpg', 'a.jpg']));

  expect(ran).toMatchObject({ run: { moved: [] }, skipped: 2 });
  expect(ran.run.trashed.map(({ id }) => id)).toEqual(['a.jpg']);
  expect(ran.error).toBeUndefined();
});

test('a rescue that can’t move out stops the run before anything goes', async () => {
  const photos = await library(['Trips/good.jpg', 'good.jpg']);
  const ran = await run(photos, plan([{ id: 'Trips/good.jpg', to: '.' }], ['Trips']));

  expect(ran.error).toBe('Couldn’t move “good.jpg” out: “good.jpg” is in the top folder already.');
  expect(ran.run).toEqual({ batch: null, moved: [], trashed: [] });
  expect(await filesOf(photos)).toEqual(['Trips/good.jpg', 'good.jpg']);
});

test('Undo puts an entry back beside one that took its place', async () => {
  const photos = await library(['beach.jpg']);
  const ran = await run(photos, plan([], ['beach.jpg']));
  await writeFile(path.join(photos.root, 'beach.jpg'), 'new');

  await expect(undoTrashRun(photos, ran.run)).resolves.toEqual({
    renamed: ['beach (restored).jpg'],
    restored: 1,
  });
  await expect(readFile(path.join(photos.root, 'beach (restored).jpg'), 'utf8')).resolves.toBe(
    'beach.jpg',
  );
  await expect(readFile(path.join(photos.root, 'beach.jpg'), 'utf8')).resolves.toBe('new');
});

test('deleting for good takes what goes, folders whole, after the rescues', async () => {
  const photos = await library([
    'Trips/bad.jpg',
    'Trips/good.jpg',
    'Trips/deep/a.jpg',
    'loose.jpg',
  ]);

  const { error, run: deleted } = await runTrashPlan(
    photos,
    plan([{ id: 'Trips/good.jpg', to: '.' }], ['Trips', 'loose.jpg']),
    await deleteForGood(photos.root),
    vi.fn(),
  );

  expect(error).toBeUndefined();
  expect(deleted).toMatchObject({
    batch: null,
    moved: [{ from: 'Trips/good.jpg', to: 'good.jpg' }],
  });
  expect(await filesOf(photos)).toEqual(['good.jpg']);
});

test('restored names keep the extension, and count up', () => {
  expect(restoredName('beach.jpg', 1)).toBe('beach (restored).jpg');
  expect(restoredName('beach.jpg', 2)).toBe('beach (restored 2).jpg');
  expect(restoredName('Trips', 1)).toBe('Trips (restored)');
  expect(restoredName('.hidden', 1)).toBe('.hidden (restored)');
});

test('a window runs the plan of the version it was shown, and can undo the run once', async () => {
  const photos = await library(['Trips/beach.jpg', 'clip.mov']);
  const backend = new WorkerBackend(photos, path.join(photos.root, '.data', 'cache'));
  const states = new Map<string, ViewState>();
  photos.views.onView((state) => states.set(state.viewId, state));
  const opened = await photos.views.open({
    descending: false,
    directoryId: '.',
    filter: { ...emptyFilter(), format: ['Video'] },
    recursive: true,
    search: '',
    show: 'all',
    sort: 'name',
    suggesting: false,
  });
  await vi.waitFor(() => expect(states.get(opened.viewId)?.loading ?? true).toBe(false));
  const { version } = states.get(opened.viewId) ?? opened;

  await expect(
    backend.trashView(opened.viewId, version + 1, noTrashChoices(), 'system'),
  ).rejects.toThrow('The folder changed since this was planned. Review it again.');
  // Nowhere but where the person was told, such as deleting for good off a share.
  await expect(
    backend.trashView(opened.viewId, version, noTrashChoices(), 'delete'),
  ).rejects.toThrow('Where these go changed since this was planned. Review it again.');
  expect(await filesOf(photos)).toEqual(['Trips/beach.jpg', 'clip.mov']);
  const ran = await backend.trashView(opened.viewId, version, noTrashChoices(), 'system');
  onTestFinished(async () => {
    if (ran.runId) {
      await backend.undoTrash(ran.runId).catch(() => null);
    }
  });

  expect(ran).toMatchObject({ destination: 'system', moved: 0, skipped: 0, trashed: 1 });
  expect(await filesOf(photos)).toEqual(['Trips/beach.jpg']);
  await expect(backend.undoTrash(ran.runId ?? '')).resolves.toEqual({ renamed: [], restored: 1 });
  expect(await filesOf(photos)).toEqual(['Trips/beach.jpg', 'clip.mov']);
  await expect(backend.undoTrash(ran.runId ?? '')).rejects.toThrow('That can no longer be undone.');
});
