import { folderLocation } from '#photos/worker/disk/share/folder-location';
import type * as prismTrash from '#photos/worker/disk/trash/prism-trash';
import { prismTrashOf } from '#photos/worker/disk/trash/prism-trash';
import { PrismTrashBatch } from '#photos/worker/disk/trash/prism-trash-batch';
import type { PhotoLibrary } from '#photos/worker/library/library';
import type * as destinations from '#photos/worker/trash/destination';
import { trashDestinationFor } from '#photos/worker/trash/destination';
import { trashService } from '#photos/worker/trash/trash-service';
import { defaultTrashChoices, emptyFilter } from '@prism/shared';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';

vi.mock('#photos/worker/disk/share/folder-location', () => ({
  folderLocation: vi.fn(() => 'network'),
}));
// The top of a temporary folder stands in for the share's, rather than the real disk's.
vi.mock('#photos/worker/disk/trash/prism-trash', async (original) => ({
  ...(await original<typeof prismTrash>()),
  prismTrashOf: vi.fn(),
}));

// Where a run goes, so a test can hold a move partway.
vi.mock('#photos/worker/trash/destination', async (original) => ({
  ...(await original<typeof destinations>()),
  trashDestinationFor: vi.fn(),
}));

function exists(file: string) {
  return lstat(file).then(
    () => true,
    () => false,
  );
}

async function onShare() {
  const made = await mkdtemp(path.join(tmpdir(), 'prism-share-'));
  const top = await realpath(made);
  onTestFinished(() => rm(top, { force: true, recursive: true }));
  const root = path.join(top, 'Photos');
  await mkdir(root);
  await writeFile(path.join(root, 'a.jpg'), 'a');
  vi.mocked(prismTrashOf).mockResolvedValue({ top, trash: path.join(top, '.prism-trash') });
  const batch = await PrismTrashBatch.open(root, { top });
  await batch.put(path.join(root, 'a.jpg'));
  await batch.keepSaved();
  return { batch, service: trashService({ root } as PhotoLibrary), top };
}

test('names the share and lists its batches', async () => {
  const { batch, service, top } = await onShare();

  await expect(service.prismTrash()).resolves.toMatchObject({
    batches: [{ entries: 1, id: path.basename(batch.dir) }],
    share: path.basename(top),
  });
});

test('a folder off a share has no Trash of Prism’s', async () => {
  const { service } = await onShare();
  vi.mocked(folderLocation).mockResolvedValueOnce('local');

  await expect(service.prismTrash()).resolves.toBeNull();
});

test('only a batch of its own Trash can be read or deleted', async () => {
  const { service, top } = await onShare();

  for (const batchId of ['..', '../Photos', '.hidden', path.join(top, 'Photos')]) {
    await expect(service.deleteTrashBatch(batchId)).rejects.toThrow('That isn’t in Prism’s Trash.');
  }
  expect(await exists(path.join(top, 'Photos'))).toBe(true);
});

test('deleting the last batch takes the Trash away', async () => {
  const { batch, service, top } = await onShare();

  await service.deleteTrashBatch(path.basename(batch.dir));

  expect(await exists(path.join(top, '.prism-trash'))).toBe(false);
});

test('emptying deletes every batch', async () => {
  const { service, top } = await onShare();
  await PrismTrashBatch.open(path.join(top, 'Photos'), { date: new Date(0), top });

  await service.emptyPrismTrash();

  expect(await exists(path.join(top, '.prism-trash'))).toBe(false);
  expect(await exists(path.join(top, 'Photos'))).toBe(true);
});

test('runs on a share go to Prism’s Trash', async () => {
  const { service, top } = await onShare();

  await expect(service.getTrashLocation()).resolves.toEqual({
    destination: 'prism',
    share: path.basename(top),
  });
});

// Windows keeps no write permission in a folder's mode.
test.skipIf(process.platform === 'win32')(
  'where Prism can’t keep a Trash, runs delete for good',
  async () => {
    const { batch, service, top } = await onShare();
    // A share Prism can't write at the top of, with no Trash yet.
    await rm(path.dirname(batch.dir), { recursive: true });
    await chmod(top, 0o555);
    onTestFinished(() => chmod(top, 0o755));

    await expect(service.getTrashLocation()).resolves.toEqual({
      blocked: 'no permission to write at its top',
      destination: 'delete',
      share: path.basename(top),
    });
  },
);

test('off a share, runs go to the system’s Trash', async () => {
  const { service } = await onShare();
  vi.mocked(folderLocation).mockResolvedValueOnce('local');

  await expect(service.getTrashLocation()).resolves.toEqual({ destination: 'system' });
});

test('as the app quits, a run under way saves what it moved into its batch', async () => {
  const { top } = await onShare();
  const root = path.join(top, 'Photos');
  for (const name of ['b.jpg', 'c.jpg']) {
    await writeFile(path.join(root, name), name);
  }
  const batch = await PrismTrashBatch.open(root, { now: () => 0, top });
  const secondMove = Promise.withResolvers<null>();
  let moves = 0;
  vi.mocked(trashDestinationFor).mockResolvedValue({
    batch: batch.dir,
    keepSaved: () => batch.keepSaved(),
    kind: 'prism',
    put: async (file) => {
      moves += 1;
      if (moves === 2) {
        await secondMove.promise;
      }
      return batch.put(file);
    },
  });
  const none = { files: 0, folders: 0, photos: 0, size: 0, videos: 0 };
  const library = {
    resolve: (id: string) => Promise.resolve(path.join(root, id)),
    root,
    trashPlans: {
      plan: () =>
        Promise.resolve({
          groups: [],
          moves: [],
          rescued: none,
          targets: ['b.jpg', 'c.jpg'],
          totals: none,
        }),
    },
    views: { specOf: () => ({ directoryId: '.', filter: emptyFilter(), search: '' }) },
  } as unknown as PhotoLibrary;
  const service = trashService(library);
  const running = service.trashView('view', 1, defaultTrashChoices(), 'prism');
  await vi.waitFor(() => expect(moves).toBe(2));

  await service.saveOpenBatches();
  const manifest = JSON.parse(await readFile(path.join(batch.dir, 'manifest.json'), 'utf8')) as {
    items: { at: string }[];
  };
  expect(manifest.items.map(({ at }) => at)).toEqual([path.join('Photos', 'b.jpg')]);

  // What moves after, before the worker is stopped, is saved as it goes.
  secondMove.resolve(null);
  await expect(running).resolves.toMatchObject({ trashed: 2 });
  const after = JSON.parse(await readFile(path.join(batch.dir, 'manifest.json'), 'utf8')) as {
    items: unknown[];
  };
  expect(after.items).toHaveLength(2);
});
