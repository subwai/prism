import { PhotoLibrary } from '#photos/library';
import type { PhotoEntry, ScanOptions } from '@prism/shared';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { expect, onTestFinished, test, vi } from 'vitest';

// Each read takes a while, as on a network share, so reads that overlap show.
const reads = vi.hoisted(() => ({ folders: [] as string[], most: 0, now: 0, realpaths: 0 }));
vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const fs = await importOriginal();
  return {
    ...fs,
    readdir: (async (...args: Parameters<typeof fs.readdir>) => {
      reads.folders.push(String(args[0]));
      reads.now += 1;
      reads.most = Math.max(reads.most, reads.now);
      try {
        await wait(10);
        return await fs.readdir(...args);
      } finally {
        reads.now -= 1;
      }
    }) as typeof fs.readdir,
    realpath: ((...args: Parameters<typeof fs.realpath>) => {
      reads.realpaths += 1;
      return fs.realpath(...args);
    }) as typeof fs.realpath,
  };
});

async function tree() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-walk-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  // Folders of different sizes, so reads finish out of order.
  for (let folder = 0; folder < 12; folder += 1) {
    const directory = path.join(root, `${folder}`, 'inner');
    await mkdir(directory, { recursive: true });
    for (let photo = 0; photo < (folder % 4) * 10; photo += 1) {
      await writeFile(path.join(root, `${folder}`, `${photo}.jpg`), '');
    }
    await writeFile(path.join(directory, 'deep.jpg'), '');
  }
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  return { library, root };
}

/** The folders whose entries `entries` list, in the order they first appear. */
function parentsOf(entries: PhotoEntry[]) {
  return entries.map((entry) => entry.parentId).filter((id, index, all) => id !== all[index - 1]);
}

async function scan(library: PhotoLibrary, options: Partial<ScanOptions> = {}) {
  const scanId = library.startScan({ directoryId: '.', recursive: true, ...options });
  const entries = [];
  let batch;
  do {
    batch = await library.nextBatch(scanId);
    expect(batch.errors).toEqual([]);
    entries.push(...batch.entries);
  } while (!batch.done);
  return entries;
}

test('recursive scans read folders at once and still list them breadth first', async () => {
  const { library } = await tree();
  reads.most = 0;
  reads.realpaths = 0;
  const entries = await scan(library);
  expect(entries).toHaveLength(12 + 12 * 1 + 3 * 60 + 12);
  expect(reads.most).toBeGreaterThan(1);
  // Only the folder the scan starts from is resolved.
  expect(reads.realpaths).toBe(1);
  // Each folder's entries arrive together, folders in the order they were found.
  const parents = parentsOf(entries);
  expect(new Set(parents).size).toBe(parents.length);
  const found = [
    '.',
    ...entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.id),
  ];
  expect(parents).toEqual(found.filter((id) => parents.includes(id)));
});

test('a recursive scan lists the folders it knows at once, rather than behind those it reads', async () => {
  const { library, root } = await tree();
  await scan(library, { directoryId: '0' });
  reads.folders = [];
  const entries = await scan(library);
  expect(entries).toHaveLength(12 + 12 * 1 + 3 * 60 + 12);
  expect(parentsOf(entries).slice(0, 3)).toEqual(['.', '0', path.join('0', 'inner')]);
  expect(reads.folders).not.toContain(path.join(root, '0'));
  expect(reads.folders).not.toContain(path.join(root, '0', 'inner'));
});

test('a scan leaves out the folders it is told to, listing them but not what they hold', async () => {
  const { library, root } = await tree();
  reads.folders = [];
  const entries = await scan(library, { excludeDirectoryIds: ['1', path.join('2', 'inner')] });
  expect(entries.map((entry) => entry.id)).toEqual(
    expect.arrayContaining(['1', path.join('2', 'inner')]),
  );
  expect(
    entries.filter((entry) => ['1', path.join('2', 'inner')].includes(entry.parentId)),
  ).toEqual([]);
  expect(reads.folders).not.toContain(path.join(root, '1'));
  // `1` held ten photos and its inner folder with one, `2/inner` one.
  expect(entries).toHaveLength(12 + 12 * 1 + 3 * 60 + 12 - 12 - 1);
});

test('a cancelled scan stops reading ahead', async () => {
  const { library } = await tree();
  const scanId = library.startScan({ directoryId: '.', recursive: true });
  await library.nextBatch(scanId);
  await library.cancelScan(scanId);
  await wait(50);
  expect(reads.now).toBe(0);
});
