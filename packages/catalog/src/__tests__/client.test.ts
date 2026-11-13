import { details, entry, spec } from '#__tests__/fixtures';
import { type Connect, inProcessHost } from '#channels';
import { Catalog } from '#client';
import type { CatalogFiles } from '#connections';
import { connectIndex, prepareIndex, readIndex } from '#photo-index';
import { prepareRatings } from '#ratings-file';
import type { ViewVersion } from '#views';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';

/** A catalog's files in a folder of their own, as the app keeps them. */
function catalogFiles(): CatalogFiles {
  const folder = mkdtempSync(path.join(tmpdir(), 'catalog-'));
  onTestFinished(() => rmSync(folder, { force: true, recursive: true }));
  return {
    index: prepareIndex(path.join(folder, 'index.db')),
    ratings: prepareRatings(path.join(folder, 'ratings.db')),
  };
}

/** A catalog of the library at `/library`, its hosts started by `connect`. */
function openCatalog(files = catalogFiles(), connect: Connect = inProcessHost) {
  const catalog = new Catalog(files, '/library', connect);
  onTestFinished(() => catalog.close());
  return catalog;
}

/**
 * Hosts on this thread whose writer, once sent a write, answers nothing more until `release`, as
 * one busy at a long write would.
 */
function heldWrites() {
  const held: (() => void)[] = [];
  const connect: Connect = (role, receive) => {
    const channel = inProcessHost(role, receive);
    return {
      close: channel.close,
      post(message) {
        const busy = held.length > 0 || ('method' in message && message.method === 'write');
        if (role.role === 'writer' && busy) {
          held.push(() => channel.post(message));
        } else {
          channel.post(message);
        }
      },
    };
  };
  return {
    connect,
    release() {
      for (const post of held.splice(0)) {
        post();
      }
    },
  };
}

async function ids(catalog: Catalog, directoryId = '.') {
  return (await catalog.call('entriesIn', directoryId)).map((row) => row.id);
}

test('the index is in WAL mode, which the reader reads beside the writer without writing', () => {
  const { index } = catalogFiles();
  const reader = readIndex(index);
  onTestFinished(() => reader.close());
  expect(reader.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
  expect(() => reader.exec('DELETE FROM items')).toThrow(/readonly/u);
});

test('the window reads while the writer is at a write, then sees it once it is committed', async () => {
  const { connect, release } = heldWrites();
  const catalog = openCatalog(catalogFiles(), connect);
  const number = catalog.write({ listed: [entry('a.jpg')] });
  const committed = catalog.committed(number);
  let done = false;
  committed.then(() => {
    done = true;
  });

  // The write waits for the writer, and the read for nothing.
  expect(await ids(catalog)).toEqual([]);
  expect(done).toBe(false);

  release();
  await committed;
  expect(await ids(catalog)).toEqual(['a.jpg']);
});

test('the window reads while another connection holds a write transaction open', async () => {
  const files = catalogFiles();
  const catalog = openCatalog(files);
  catalog.write({ listed: [entry('a.jpg')] });
  await catalog.committed();

  // Another folder's worker, say, writing the same index for a long time.
  const other = connectIndex(files.index);
  onTestFinished(() => other.close());
  other.exec("BEGIN IMMEDIATE; DELETE FROM items WHERE id = 'a.jpg';");
  const started = performance.now();
  expect(await ids(catalog)).toEqual(['a.jpg']);
  // Well inside the five seconds a connection waits for another's write.
  expect(performance.now() - started).toBeLessThan(1000);
  other.exec('ROLLBACK');
});

test('views advance to new versions as the writer commits, with pages of what it wrote', async () => {
  const catalog = openCatalog();
  const told: ViewVersion[] = [];
  catalog.onEvent(({ view }) => told.push(view));
  catalog.write({ listed: [entry('b.jpg')] });
  await catalog.committed();
  const first = await catalog.call('openView', 'view', spec());
  expect(first).toMatchObject({ count: 1 });

  catalog.write({ listed: [entry('a.jpg'), entry('c.jpg')] });
  await catalog.committed();
  const second = await catalog.call('refreshView', 'view');
  expect(second?.version).toBeGreaterThan(first.version);
  expect(second?.count).toBe(3);
  const page = await catalog.call('viewRows', 'view', second?.version ?? 0, 1, 2);
  expect(page?.map((row) => row.id)).toEqual(['b.jpg', 'c.jpg']);
  // The version before still answers.
  const before = await catalog.call('viewRows', 'view', first.version, 0, 10);
  expect(before?.map((row) => row.id)).toEqual(['b.jpg']);

  // A write the window made no read after still reaches it, as a new version told unasked.
  catalog.write({ removed: ['b.jpg'] });
  await vi.waitFor(() => expect(told.at(-1)?.count).toBe(2), { interval: 50, timeout: 3000 });
  expect(told.at(-1)?.version).toBeGreaterThan(second?.version ?? 0);
});

test('an edit is seen by the next read, with no wait for queued writes', async () => {
  const catalog = openCatalog();
  catalog.write({ listed: [entry('trips'), entry('clip.mov', { kind: 'video' })] });
  await catalog.committed();
  const { version } = await catalog.call('openView', 'view', spec());

  // The writer answers an edit once it is committed, and tells the reader first.
  await catalog.call('rate', 'clip.mov', 3);
  const rows = await catalog.call('entriesIn', '.');
  expect(rows.find((row) => row.id === 'clip.mov')?.rating).toBe(3);
  const refreshed = await catalog.call('refreshView', 'view');
  expect(refreshed?.version).toBeGreaterThan(version);
  const filtered = await catalog.call(
    'openView',
    'rated',
    spec({ filter: { ...spec().filter, rating: ['min3'] } }),
  );
  expect(filtered.count).toBe(1);

  await catalog.call('moveRatings', 'clip.mov', 'renamed.mov');
  expect((await catalog.call('entriesIn', '.')).find((row) => row.id === 'clip.mov')?.rating).toBe(
    undefined,
  );
});

test('the details queue reads first the photos the window last asked for', async () => {
  const catalog = openCatalog();
  catalog.write({ listed: Array.from({ length: 6 }, (_photo, index) => entry(`${index}.jpg`)) });
  await catalog.committed();
  const { version } = await catalog.call('openView', 'view', spec());
  await catalog.call('viewRows', 'view', version, 4, 2);
  expect((await catalog.call('wanted', 2)).map(({ id }) => id)).toEqual(['4.jpg', '5.jpg']);

  catalog.write({ details: [details('4.jpg', {}), details('5.jpg', {})] });
  expect((await catalog.call('wanted', 2)).map(({ id }) => id)).toEqual(['0.jpg', '1.jpg']);
});

test('a catalog kept in memory shares one connection between its reader and writer', async () => {
  const catalog = openCatalog({ index: ':memory:', ratings: ':memory:' });
  catalog.write({ listed: [entry('a')] });
  await catalog.committed();
  expect(await ids(catalog)).toEqual(['a']);
  const { version } = await catalog.call('openView', 'view', spec());
  await catalog.call('rate', 'a', 2);
  expect((await catalog.call('refreshView', 'view'))?.version).toBeGreaterThan(version);
});
