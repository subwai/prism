import { PhotoLibrary } from '#photos/worker/library/library';
import { prepareIndex, prepareRatings } from '@prism/catalog';
import { emptyFilter, type ViewSpec, type ViewState } from '@prism/shared';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { onTestFinished } from 'vitest';

// Views are made again at most every half a second while rows arrive.
export const SETTLED = { interval: 50, timeout: 3000 };

export async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'library-views-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

/** A small JPEG that `model` took at `taken`. */
export async function jpeg(file: string, model: string, taken = '2023:05:01 12:34:56') {
  await sharp({ create: { background: 'red', channels: 3, height: 8, width: 8 } })
    .jpeg()
    .withExif({ IFD0: { Make: 'Canon', Model: model }, IFD2: { DateTimeOriginal: taken } })
    .toFile(file);
}

export function spec(overrides: Partial<ViewSpec> = {}): ViewSpec {
  return {
    descending: false,
    directoryId: '.',
    filter: emptyFilter(),
    recursive: false,
    search: '',
    show: 'all',
    sort: 'name',
    suggesting: false,
    ...overrides,
  };
}

/**
 * A library whose views' latest states are kept, as a window receives them. Its catalog is kept
 * in files, a new index unless `indexFile` names one, so its reader and writer each have
 * connections of their own, as in the app.
 */
export async function openLibrary(root: string, indexFile?: string) {
  const index = indexFile ?? prepareIndex(path.join(await fixture(), 'index.db'));
  const ratingsFile = path.join(path.dirname(index), 'ratings.db');
  const library = PhotoLibrary.open(await realpath(root), {
    files: { index, ratings: prepareRatings(ratingsFile) },
  });
  onTestFinished(() => library.close());
  const states = new Map<string, ViewState>();
  library.views.onNewVersion((state) => states.set(state.viewId, state));
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
