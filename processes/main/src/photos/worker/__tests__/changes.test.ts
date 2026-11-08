import { createChangeTracker } from '#photos/worker/changes';
import { openLibrary } from '#photos/worker/library';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test } from 'vitest';

const PHOTO = path.join('Trips', 'photo.png'),
  ADDED = path.join('Trips', 'added.png');

function image(file: string, width = 800) {
  return sharp({ create: { background: '#4678ab', channels: 3, height: 600, width } })
    .png()
    .toFile(file);
}

function inTrips(id: string) {
  return { id, parentId: 'Trips' };
}

async function listed() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-changes-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, 'Trips'));
  await image(path.join(root, PHOTO));
  await writeFile(path.join(root, 'Trips', 'notes.txt'), '');
  const library = await openLibrary(root);
  onTestFinished(() => library.close());
  await library.listFolder('.');
  await library.listFolder('Trips');
  await library.original(PHOTO);
  return { library, root };
}

test('leaves out events that changed nothing, and files that came and went unseen', async () => {
  const { library } = await listed();
  const changes = [inTrips(PHOTO), inTrips(path.join('Trips', 'gone.png'))];
  await expect(library.describeChanges(changes)).resolves.toEqual([]);
});

test('describes rewritten and added files as they are now', async () => {
  const { library, root } = await listed();
  await image(path.join(root, PHOTO), 80);
  await image(path.join(root, ADDED));
  const [rewritten, added] = await library.describeChanges([inTrips(PHOTO), inTrips(ADDED)]);
  expect(rewritten).toMatchObject({
    contentChanged: true,
    entry: { kind: 'image' },
    listingChanged: false,
  });
  expect(added).toMatchObject({
    contentChanged: false,
    entry: { id: ADDED, kind: 'image', name: 'added.png', parentId: 'Trips' },
    listingChanged: true,
  });
  expect(added?.entry?.metadata?.size).toBeGreaterThan(0);
});

test('a file read again after it changed, before its event arrives, is still described', async () => {
  const { library, root } = await listed();
  await image(path.join(root, PHOTO), 80);
  // Such as a thumbnail that was waiting its turn, while what is on screen shows the old photo.
  await library.original(PHOTO);
  const [rewritten] = await library.describeChanges([inTrips(PHOTO)]);
  expect(rewritten).toMatchObject({ contentChanged: true, listingChanged: false });
});

test('a removed folder takes what was inside it along', async () => {
  const { library, root } = await listed();
  await rm(path.join(root, 'Trips'), { force: true, recursive: true });
  await expect(library.describeChanges([{ id: 'Trips', parentId: '.' }])).resolves.toEqual([
    { contentChanged: false, entry: null, id: 'Trips', listingChanged: true, parentId: '.' },
  ]);
  await expect(library.describeChanges([inTrips(PHOTO)])).resolves.toEqual([]);
});

test('a removed folder forgets a large tree inside it without searching every entry', async () => {
  const { library, root } = await listed();
  const tracker = createChangeTracker(root);
  for (let index = 0; index < 20_000; index += 1) {
    tracker.listed({
      id: path.join('Big', `${index}.jpg`),
      kind: 'image',
      name: '',
      parentId: 'Big',
    });
  }
  tracker.listed({ id: 'Big', kind: 'directory', name: 'Big', parentId: '.' });
  const removals = Array.from({ length: 2000 }, (_entry, index) => ({
    id: path.join('Big', `${index}.jpg`),
    parentId: 'Big',
  }));
  const started = performance.now();
  const described = await tracker.describe([{ id: 'Big', parentId: '.' }, ...removals]);
  expect(described).toHaveLength(1);
  expect(performance.now() - started).toBeLessThan(2000);
  await library.close();
});
