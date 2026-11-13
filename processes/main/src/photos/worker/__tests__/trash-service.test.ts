import type { PhotoLibrary } from '#photos/worker/library';
import { folderLocation } from '#photos/worker/location';
import type * as prismTrash from '#photos/worker/prism-trash';
import { PrismTrashBatch, prismTrashOf } from '#photos/worker/prism-trash';
import { trashService } from '#photos/worker/trash-service';
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';

vi.mock('#photos/worker/location', () => ({ folderLocation: vi.fn(() => 'network') }));
// The top of a temporary folder stands in for the share's, rather than the real disk's.
vi.mock('#photos/worker/prism-trash', async (original) => ({
  ...(await original<typeof prismTrash>()),
  prismTrashOf: vi.fn(),
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
  return { batch, service: trashService({ root } as PhotoLibrary), top };
}

test('names the share and lists its batches', async () => {
  const { batch, service, top } = await onShare();

  await expect(service.prismTrash()).resolves.toMatchObject({
    batches: [{ id: path.basename(batch.dir), items: 1 }],
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
