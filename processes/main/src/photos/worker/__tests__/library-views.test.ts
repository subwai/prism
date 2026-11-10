import type { Indexer } from '#photos/worker/indexer';
import { PhotoLibrary } from '#photos/worker/library';
import { LibraryViews } from '#photos/worker/library-views';
import { type Catalog, prepareIndex } from '@prism/catalog';
import type { ViewSpec, ViewState } from '@prism/shared';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
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
async function openLibrary(root: string, indexFile?: string) {
  const library = await PhotoLibrary.open(root, indexFile);
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
  const first = await openLibrary(root, prepareIndex(indexFile));
  const viewId = await first.open({ recursive: true, show: 'media' });
  await vi.waitFor(() => {
    expect(first.stateOf(viewId)).toMatchObject({ count: 1, loading: false, unread: 0 });
  }, SETTLED);
  await first.library.close();

  const again = await openLibrary(root, prepareIndex(indexFile));
  const reopened = await again.open({ recursive: true, show: 'media' });
  expect(again.stateOf(reopened)).toMatchObject({ count: 1, unread: 0 });
  expect(await again.ids(reopened)).toEqual(['deep/a.jpg']);
});

test('details read in one library are found again by another holding the same photo', async () => {
  const root = await fixture();
  const indexFile = prepareIndex(path.join(await fixture(), 'index.db'));
  await mkdir(path.join(root, 'inner'));
  const file = path.join(root, 'inner', 'a.jpg');
  // A whole second, which setting the time again can match exactly.
  const taken = new Date(2024, 0, 1);
  await jpeg(file, 'EOS R5');
  await utimes(file, taken, taken);
  const camera = async (folder: string, directoryId: string) => {
    const opened = await openLibrary(folder, indexFile);
    const viewId = await opened.open({ directoryId, sort: 'taken' });
    await vi.waitFor(() => expect(opened.stateOf(viewId).unread).toBe(0), SETTLED);
    const { version } = opened.stateOf(viewId);
    const [photo] = (await opened.library.views.rows(viewId, version, 0, 1)) ?? [];
    await opened.library.close();
    return photo?.exif?.camera;
  };
  expect(await camera(path.join(root, 'inner'), '.')).toBe('Canon EOS R5');

  // Rewritten in place with the same size and time, it looks unchanged, so the cache answers.
  const before = await stat(file);
  await jpeg(file, 'EOS R6');
  expect((await stat(file)).size).toBe(before.size);
  await utimes(file, taken, taken);
  expect(await camera(root, 'inner')).toBe('Canon EOS R5');

  // Any other edit reads it again.
  await utimes(file, taken, new Date(taken.getTime() + 5000));
  expect(await camera(root, 'inner')).toBe('Canon EOS R6');
});

test("a batch's views hold its changes at once, and no older version is told after", async () => {
  const root = await fixture();
  await jpeg(path.join(root, 'a.jpg'), 'EOS R5');
  const { library, open, stateOf } = await openLibrary(root);
  const viewId = await open();
  await vi.waitFor(
    () => expect(stateOf(viewId)).toMatchObject({ count: 1, loading: false }),
    SETTLED,
  );
  await jpeg(path.join(root, 'b.jpg'), 'EOS R5');
  const told = vi.fn();
  library.views.onView(told);
  await library.describeChanges([{ id: 'b.jpg', parentId: '.' }]);
  const [state] = await library.views.current();
  expect(state).toMatchObject({ count: 2, viewId });
  expect(state?.version).toBeGreaterThan(stateOf(viewId).version);
  const rows = await library.views.rows(viewId, state?.version ?? 0, 0, 2);
  expect(rows?.map(({ id }) => id)).toEqual(['a.jpg', 'b.jpg']);
  // The catalog's own version of the same writes is no news; only later ones are told, such
  // as once the photo's details are read.
  await new Promise((resolve) => {
    setTimeout(resolve, 600);
  });
  for (const [later] of told.mock.calls) {
    expect(later.version).toBeGreaterThan(state?.version ?? 0);
  }
});

/** Unsubscribes from what the fake catalog never sends. */
function unsubscribe() {
  // Nothing to stop.
}

test('a view the catalog fails to open stops the read it started', async () => {
  const reads: AbortSignal[] = [];
  const settled = Promise.resolve();
  const views = new LibraryViews({
    busy: () => false,
    catalog: {
      call: (method: string) =>
        method === 'openView' ? Promise.reject(new Error('The catalog is closed.')) : settled,
      onEvent: () => unsubscribe,
    } as unknown as Catalog,
    indexer: {
      index(_scope: unknown, signal: AbortSignal) {
        reads.push(signal);
        return { done: settled, error: null, errors: [], finished: false, first: settled };
      },
    } as unknown as Indexer,
    resolve: (id) => Promise.resolve(id),
    root: '/library',
    signal: new AbortController().signal,
  });
  await expect(views.open(spec())).rejects.toThrow('The catalog is closed.');
  expect(reads.map((signal) => signal.aborted)).toEqual([true]);
});
