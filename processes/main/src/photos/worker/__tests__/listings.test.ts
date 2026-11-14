import { PhotoLibrary } from '#photos/worker/library';
import { LIMITS } from '#photos/worker/scheduling';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

async function openLibrary() {
  const made = await mkdtemp(path.join(tmpdir(), 'listings-'));
  const root = await realpath(made);
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  const library = PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  const relisted: string[] = [];
  library.onRelisted((folderIds) => relisted.push(...folderIds));
  return { library, relisted, root };
}

test('a listing answers from the catalog at once, and the window hears once the read lands', async () => {
  const { library, relisted, root } = await openLibrary();
  await mkdir(path.join(root, 'Trips'));
  await writeFile(path.join(root, 'a.jpg'), '');
  // Every read of a folder the window could wait for is taken.
  const busy = Promise.withResolvers<null>();
  for (let index = 0; index < LIMITS.folder.visible; index += 1) {
    library.scheduler
      .run(
        'folder',
        `busy ${index}`,
        () => 'visible',
        () => busy.promise,
      )
      .catch(() => null);
  }
  await expect(library.listFolder('.')).resolves.toEqual({
    entries: [],
    error: null,
    missing: false,
    read: false,
  });
  expect(relisted).toEqual([]);
  busy.resolve(null);
  await library.readFolder('.');
  await expect.poll(() => relisted).toContain('.');
  const listing = await library.listFolder('.');
  expect(listing).toMatchObject({ error: null, read: true });
  expect(listing.entries.map((entry) => entry.id)).toEqual(['Trips', 'a.jpg']);
});

test('a folder that cannot be read says why once the read finds out, and is told of', async () => {
  const { library, relisted } = await openLibrary();
  await expect(library.listFolder('gone')).resolves.toMatchObject({ error: null, read: false });
  await library.readFolder('gone');
  await expect.poll(() => relisted).toEqual(['gone']);
  await expect(library.listFolder('gone')).resolves.toMatchObject({
    entries: [],
    error: expect.stringMatching(/ENOENT/u),
    missing: true,
  });
});
