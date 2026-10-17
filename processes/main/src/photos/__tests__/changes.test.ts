import { PhotoLibrary } from '#photos/library';
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

async function scanned() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-changes-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, 'Trips'));
  await image(path.join(root, PHOTO));
  await writeFile(path.join(root, 'Trips', 'notes.txt'), '');
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  const scanId = library.startScan({ directoryId: '.', recursive: true });
  let batch;
  do {
    batch = await library.nextBatch(scanId);
  } while (!batch.done);
  await library.original(PHOTO);
  return { library, root };
}

test('leaves out events that changed nothing, and files that came and went unseen', async () => {
  const { library } = await scanned();
  const changes = [inTrips(PHOTO), inTrips(path.join('Trips', 'gone.png'))];
  await expect(library.describeChanges(changes)).resolves.toEqual([]);
});

test('describes rewritten and added files as they are now', async () => {
  const { library, root } = await scanned();
  await image(path.join(root, PHOTO), 80);
  await image(path.join(root, ADDED));
  const [rewritten, added] = await library.describeChanges([inTrips(PHOTO), inTrips(ADDED)]);
  expect(rewritten).toMatchObject({
    contentChanged: true,
    entry: { kind: 'image' },
    listingChanged: false
  });
  expect(added).toMatchObject({
    contentChanged: false,
    entry: { id: ADDED, kind: 'image', name: 'added.png', parentId: 'Trips' },
    listingChanged: true
  });
  expect(added?.entry?.metadata?.size).toBeGreaterThan(0);
});

test('a removed folder takes what was inside it along', async () => {
  const { library, root } = await scanned();
  await rm(path.join(root, 'Trips'), { force: true, recursive: true });
  await expect(library.describeChanges([{ id: 'Trips', parentId: '.' }])).resolves.toEqual([
    { contentChanged: false, entry: null, id: 'Trips', listingChanged: true, parentId: '.' }
  ]);
  await expect(library.describeChanges([inTrips(PHOTO)])).resolves.toEqual([]);
});
