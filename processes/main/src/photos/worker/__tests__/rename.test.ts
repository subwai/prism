import { PhotoLibrary } from '#photos/worker/library';
import { renameEntry } from '#photos/worker/rename';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

const PHOTO = path.join('Trips', 'photo.jpg');

async function listed() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-rename-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, 'Trips'));
  await writeFile(path.join(root, PHOTO), 'photo');
  await writeFile(path.join(root, 'Trips', 'other.jpg'), 'other');
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  await library.listFolder('.');
  await library.listFolder('Trips');
  return { library, root };
}

test('renames a photo in its folder, and reports it moved', async () => {
  const { library, root } = await listed();
  const renamed = path.join('Trips', 'beach.jpg');
  const { entry, changes } = await renameEntry(library, PHOTO, 'beach.jpg');
  expect(entry).toMatchObject({ id: renamed, kind: 'image', name: 'beach.jpg', parentId: 'Trips' });
  expect(changes).toEqual([
    { contentChanged: false, entry: null, id: PHOTO, listingChanged: true, parentId: 'Trips' },
    { contentChanged: false, entry, id: renamed, listingChanged: true, parentId: 'Trips' },
  ]);
  await expect(readdir(path.join(root, 'Trips'))).resolves.toEqual(['beach.jpg', 'other.jpg']);
  // The watcher's report of the same rename has nothing left to say.
  await expect(
    library.describeChanges([
      { id: PHOTO, parentId: 'Trips' },
      { id: renamed, parentId: 'Trips' },
    ]),
  ).resolves.toEqual([]);
});

test('renames a folder, and finds what is inside under its new name', async () => {
  const { library } = await listed();
  const { entry } = await renameEntry(library, 'Trips', 'Holidays');
  expect(entry).toMatchObject({ id: 'Holidays', kind: 'directory' });
  await expect(library.resolve(path.join('Holidays', 'photo.jpg'))).resolves.toMatch(
    /photo\.jpg$/u,
  );
});

test('never replaces another entry', async () => {
  const { library, root } = await listed();
  await expect(renameEntry(library, PHOTO, 'other.jpg')).rejects.toThrow(
    'The name “other.jpg” is already taken. Choose a different name.',
  );
  await expect(readdir(path.join(root, 'Trips'))).resolves.toEqual(['other.jpg', 'photo.jpg']);
});

test('only changes the capitalization when that is all that differs', async () => {
  const { library, root } = await listed();
  const { entry } = await renameEntry(library, PHOTO, 'Photo.jpg');
  expect(entry.id).toBe(path.join('Trips', 'Photo.jpg'));
  await expect(readdir(path.join(root, 'Trips'))).resolves.toEqual(['Photo.jpg', 'other.jpg']);
});

test('keeping the same name changes nothing', async () => {
  const { library } = await listed();
  await expect(renameEntry(library, PHOTO, 'photo.jpg')).resolves.toMatchObject({
    changes: [],
    entry: { id: PHOTO },
  });
});

test.each([
  ['', 'Enter a name.'],
  ['   ', 'Enter a name.'],
  ['..', '“..” can’t be used as a name.'],
  ['a/b.jpg', '“a/b.jpg” can’t be used as a name.'],
  ['.DS_Store', '“.DS_Store” can’t be used as a name.'],
  ['x'.repeat(256), 'That name is too long.'],
])('refuses the name %j', async (name, message) => {
  const { library } = await listed();
  await expect(renameEntry(library, PHOTO, name)).rejects.toThrow(message);
});

test('refuses the open folder, and entries outside it', async () => {
  const { library } = await listed();
  await expect(renameEntry(library, '.', 'Elsewhere')).rejects.toThrow(
    'The open folder can’t be renamed here.',
  );
  await expect(renameEntry(library, '../outside.jpg', 'inside.jpg')).rejects.toThrow(
    'Entry is outside the selected folder.',
  );
});
