import { WorkerBackend } from '#photos/worker/backend';
import { describeChanges } from '#photos/worker/changes/describe-changes';
import { reportChanges } from '#photos/worker/changes/report-changes';
import { type ShownFiles, updateShownFiles } from '#photos/worker/changes/shown-files';
import { PhotoLibrary } from '#photos/worker/library';
import type { WorkerEvent } from '@prism/shared';
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test, vi } from 'vitest';

const PHOTO = path.join('Trips', 'photo.png');
const ADDED = path.join('Trips', 'added.png');

function image(file: string, width = 800) {
  return sharp({ create: { background: '#4678ab', channels: 3, height: 600, width } })
    .png()
    .toFile(file);
}

function inTrips(id: string) {
  return { id, parentId: 'Trips' };
}

/** A photo inside `Big` that the catalog knew and is gone now. */
function goneInBig(index: number) {
  const id = path.join('Big', `${index}.jpg`);
  return {
    entry: null,
    id,
    known: { id, inode: '1', kind: 'image' as const, modifiedMs: 1, size: 1 },
    parentId: 'Big',
    shownAs: undefined,
  };
}

async function listed() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-changes-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, 'Trips'));
  await image(path.join(root, PHOTO));
  await writeFile(path.join(root, 'Trips', 'notes.txt'), '');
  const library = PhotoLibrary.open(await realpath(root));
  onTestFinished(() => library.close());
  await library.readFolder('.');
  await library.readFolder('Trips');
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

test('a file written again before the window reads it is still described as rewritten', async () => {
  const { library, root } = await listed();
  // A file written in place raises events part way through, and again once it is done.
  await writeFile(path.join(root, PHOTO), '');
  const [partial] = await library.describeChanges([inTrips(PHOTO)]);
  expect(partial).toMatchObject({ contentChanged: true });
  // The window's read of the new contents is still on its way.
  await image(path.join(root, PHOTO), 80);
  const [finished] = await library.describeChanges([inTrips(PHOTO)]);
  expect(finished).toMatchObject({ contentChanged: true, listingChanged: false });
});

test('a removed folder takes what was inside it along', async () => {
  const { library, root } = await listed();
  await rm(path.join(root, 'Trips'), { force: true, recursive: true });
  await expect(library.describeChanges([{ id: 'Trips', parentId: '.' }])).resolves.toEqual([
    { contentChanged: false, entry: null, id: 'Trips', listingChanged: true, parentId: '.' },
  ]);
  await expect(library.describeChanges([inTrips(PHOTO)])).resolves.toEqual([]);
});

test('a removed folder takes a large tree inside it along, without searching every entry', () => {
  const big = {
    entry: null,
    id: 'Big',
    known: { id: 'Big', inode: '2', kind: 'directory' as const, modifiedMs: null, size: null },
    parentId: '.',
    shownAs: undefined,
  };
  const removals = Array.from({ length: 20_000 }, (_entry, index) => goneInBig(index));
  const started = performance.now();
  expect(describeChanges([...removals.slice(0, 10_000), big, ...removals.slice(10_000)])).toEqual([
    { contentChanged: false, entry: null, id: 'Big', listingChanged: true, parentId: '.' },
  ]);
  expect(performance.now() - started).toBeLessThan(2000);
});

test('a photo on screen that the catalog already lists as rewritten is still described', () => {
  // A folder read again wrote the rewrite to the catalog before the watcher's event came.
  const known = { id: PHOTO, inode: '1', kind: 'image' as const, modifiedMs: 2, size: 20 };
  const entry = {
    id: PHOTO,
    kind: 'image' as const,
    metadata: { accessedMs: 2, createdMs: 1, modifiedMs: 2, size: 20 },
    name: 'photo.png',
    parentId: 'Trips',
  };
  expect(describeChanges([{ ...inTrips(PHOTO), entry, known, shownAs: '10:1' }])).toEqual([
    { contentChanged: true, entry, id: PHOTO, listingChanged: false, parentId: 'Trips' },
  ]);
});

test('a file on screen stays read as it changes, until the window reads it again', () => {
  const known = { id: PHOTO, inode: '1', kind: 'image' as const, modifiedMs: 1, size: 10 };
  const shown: ShownFiles = new Map([[PHOTO, '10:1']]);
  /** The photo as one batch of events finds it, described against what `shown` holds. */
  function batch(size: number, modifiedMs: number) {
    const entry = {
      id: PHOTO,
      kind: 'image' as const,
      metadata: { accessedMs: modifiedMs, createdMs: 1, modifiedMs, size },
      name: 'photo.png',
      parentId: 'Trips',
    };
    const described = describeChanges([
      { ...inTrips(PHOTO), entry, known, shownAs: shown.get(PHOTO) },
    ]);
    updateShownFiles(shown, described);
    return described.map(({ contentChanged }) => contentChanged);
  }
  // Written in place: half-way, then done, before the window's new read arrives.
  expect(batch(0, 2)).toEqual([true]);
  expect(batch(20, 3)).toEqual([true]);
  // An event that changed nothing, such as metadata a viewer added.
  expect(batch(20, 3)).toEqual([]);
});

test('the opened folder going away lists it as missing, and coming back as there', async () => {
  const { library, root } = await listed();
  const moved = `${root}-moved`;
  onTestFinished(() => rm(moved, { force: true, recursive: true }));
  await rename(root, moved);
  library.forget();
  await library.readFolder('.');
  await expect(library.listFolder('.')).resolves.toMatchObject({ entries: [], missing: true });
  await rename(moved, root);
  library.forget();
  await library.readFolder('.');
  await expect(library.listFolder('.')).resolves.toMatchObject({ error: null, missing: false });
});

test('a photo on show that is rewritten is told stale, and only then made again', async () => {
  const { library, root } = await listed();
  const tell = vi.fn<(event: WorkerEvent) => void>();
  const backend = new WorkerBackend(library, path.join(root, 'cache'), undefined, tell);
  const thumbnails = () =>
    tell.mock.calls.flatMap(([event]) => (event.kind === 'thumbnail' ? [event] : []));
  await backend.reportScreenContents({ foldersToRead: [], shown: [PHOTO], views: [] });
  await vi.waitFor(() => expect(thumbnails()).toHaveLength(1));
  await image(path.join(root, PHOTO), 80);
  const stale = vi.spyOn(backend, 'stale');
  reportChanges({ backend, library, tell }, { changed: [inTrips(PHOTO)], everything: false });
  await vi.waitFor(() => expect(thumbnails()).toHaveLength(2));
  // Made again only once the window was told to forget the old one, so it cannot arrive first.
  const told = tell.mock.calls.findIndex(([event]) => event.kind === 'stale');
  expect(tell.mock.invocationCallOrder[told]).toBeLessThan(stale.mock.invocationCallOrder[0] ?? 0);
  const [before, after] = thumbnails();
  expect(after?.thumbnail.status).toBe('ready');
  expect(after).not.toEqual(before);
});
