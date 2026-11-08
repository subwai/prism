import { PhotoLibrary } from '#photos/library';
import { PhotoIndex } from '#photos/photo-index';
import type { ViewSpec, ViewState } from '@prism/shared';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test, vi } from 'vitest';

// Views are made again at most every half a second while rows arrive.
const SETTLED = { interval: 50, timeout: 3000 };

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'library-views-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

/** A small JPEG that `model` took at `taken`. */
async function jpeg(file: string, model: string, taken = '2023:05:01 12:34:56') {
  await sharp({ create: { background: 'red', channels: 3, height: 8, width: 8 } })
    .jpeg()
    .withExif({ IFD0: { Make: 'Canon', Model: model }, IFD2: { DateTimeOriginal: taken } })
    .toFile(file);
}

function spec(overrides: Partial<ViewSpec> = {}): ViewSpec {
  return {
    descending: false,
    directoryId: '.',
    filter: { camera: [], format: [], lens: [], tag: [] },
    recursive: false,
    search: '',
    show: 'all',
    sort: 'name',
    suggesting: false,
    ...overrides,
  };
}

/** A library whose views' latest states are kept, as a window hears of them. */
async function openLibrary(root: string, index?: PhotoIndex) {
  const library = await PhotoLibrary.open(root, index);
  onTestFinished(() => library.close());
  const states = new Map<string, ViewState>();
  library.views.onView((state) => states.set(state.viewId, state));
  const open = async (overrides: Partial<ViewSpec> = {}) => {
    const state = await library.views.open(spec(overrides));
    states.set(state.viewId, state);
    return state.viewId;
  };
  const stateOf = (viewId: string) => states.get(viewId) as ViewState;
  const ids = async (viewId: string) => {
    const { version, count } = stateOf(viewId);
    const rows = await library.views.rows(viewId, version, 0, Math.min(count, 1024));
    return (rows ?? []).map((row) => row.id);
  };
  return { ids, library, open, stateOf };
}

test('a view opens with its folder, and a recursive one fills in as folders are read', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'a', 'b'), { recursive: true });
  await writeFile(path.join(root, 'top.jpg'), '');
  await writeFile(path.join(root, 'a', 'one.jpg'), '');
  await writeFile(path.join(root, 'a', 'b', 'two.mov'), '');
  const { ids, open, stateOf } = await openLibrary(root);

  const grid = await open();
  expect(await ids(grid)).toEqual(['a', 'top.jpg']);

  const filmstrip = await open({ recursive: true, show: 'media' });
  await vi.waitFor(() => expect(stateOf(filmstrip).loading).toBe(false), SETTLED);
  await vi.waitFor(async () => {
    expect(await ids(filmstrip)).toEqual(['a/one.jpg', 'top.jpg', 'a/b/two.mov']);
  }, SETTLED);
  expect(stateOf(filmstrip).errors).toEqual([]);
});

test('photos’ details are read in the background, for filters and the sort by date taken', async () => {
  const root = await fixture();
  await jpeg(path.join(root, 'a.jpg'), 'EOS R5', '2024:01:01 00:00:00');
  await jpeg(path.join(root, 'b.jpg'), 'EOS R6', '2020:01:01 00:00:00');
  const { ids, library, open, stateOf } = await openLibrary(root);

  const viewId = await open({ sort: 'taken' });
  await vi.waitFor(() => expect(stateOf(viewId).unread).toBe(0), SETTLED);
  expect(await ids(viewId)).toEqual(['b.jpg', 'a.jpg']);
  const facets = await library.views.facets(viewId);
  expect(facets.fields.camera.map(({ value }) => value)).toEqual(['Canon EOS R5', 'Canon EOS R6']);

  const filtered = await open({
    filter: { camera: ['Canon EOS R6'], format: [], lens: [], tag: [] },
  });
  expect(await ids(filtered)).toEqual(['b.jpg']);
});

test('background reads make way while thumbnails are being made', async () => {
  const root = await fixture();
  await jpeg(path.join(root, 'a.jpg'), 'EOS R5');
  const { library, open, stateOf } = await openLibrary(root);
  let busy = true;
  library.setBusy(() => busy);

  const viewId = await open();
  await new Promise((resolve) => {
    setTimeout(resolve, 700);
  });
  expect((await library.views.facets(viewId)).unread).toBe(1);
  busy = false;
  await vi.waitFor(() => expect(stateOf(viewId).unread).toBe(0), SETTLED);
});

test('changes on disk reach views without reading their folders again', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'a.jpg'), '');
  const { ids, library, open } = await openLibrary(root);
  const viewId = await open();
  expect(await ids(viewId)).toEqual(['a.jpg']);

  await writeFile(path.join(root, 'b.jpg'), '');
  await rm(path.join(root, 'a.jpg'));
  await library.describeChanges([
    { id: 'a.jpg', parentId: '.' },
    { id: 'b.jpg', parentId: '.' },
  ]);
  await vi.waitFor(async () => expect(await ids(viewId)).toEqual(['b.jpg']), SETTLED);
});

test('a library opened again shows the catalog at once, with the details read before', async () => {
  const root = await fixture();
  const indexFile = path.join(await fixture(), 'index.db');
  await mkdir(path.join(root, 'deep'));
  await jpeg(path.join(root, 'deep', 'a.jpg'), 'EOS R5');
  const first = await openLibrary(root, PhotoIndex.open(indexFile));
  const viewId = await first.open({ recursive: true, show: 'media' });
  await vi.waitFor(() => {
    expect(first.stateOf(viewId)).toMatchObject({ count: 1, loading: false, unread: 0 });
  }, SETTLED);
  await first.library.close();

  const again = await openLibrary(root, PhotoIndex.open(indexFile));
  const reopened = await again.open({ recursive: true, show: 'media' });
  expect(again.stateOf(reopened)).toMatchObject({ count: 1, unread: 0 });
  expect(await again.ids(reopened)).toEqual(['deep/a.jpg']);
});
