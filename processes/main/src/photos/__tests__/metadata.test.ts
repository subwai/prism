import { PhotoLibrary } from '#photos/library';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-metadata-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

async function scanAll(library: PhotoLibrary) {
  const scanId = library.startScan({ directoryId: '.', recursive: true });
  for (let batch = await library.nextBatch(scanId); !batch.done;) {
    batch = await library.nextBatch(scanId);
  }
}

test('metadata is read for listed entries only, and for none that are gone', async () => {
  const root = await fixture();
  const outside = await fixture();
  await mkdir(path.join(root, 'a'));
  await writeFile(path.join(root, 'a', 'photo.jpg'), 'four');
  await writeFile(path.join(root, 'gone.jpg'), '');
  await writeFile(path.join(outside, 'private.jpg'), '');
  await symlink(outside, path.join(root, 'outside'), 'dir');
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  await scanAll(library);
  await rm(path.join(root, 'gone.jpg'));
  const ids = [path.join('a', 'photo.jpg'), 'gone.jpg', path.join('outside', 'private.jpg')];
  const [photo, gone, unlisted] = await library.readMetadata(ids);
  expect(photo).toMatchObject({ size: 4 });
  expect(typeof photo?.modifiedMs).toBe('number');
  expect(gone).toBeNull();
  expect(unlisted).toBeNull();
  expect(() => library.readMetadata('a' as never)).toThrow(/list/u);
  expect(() => library.readMetadata(Array.from({ length: 1025 }, () => 'a'))).toThrow(/at most/u);
});
