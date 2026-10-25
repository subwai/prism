import { type PathChanges, watchFolder } from '#photos/watcher';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';

async function watched() {
  const created = await mkdtemp(path.join(tmpdir(), 'photo-watch-'));
  // Events name paths under the real location, which on macOS is past a symlink.
  const root = await realpath(created);
  const controller = new AbortController();
  const reports: PathChanges[] = [];
  onTestFinished(async () => {
    controller.abort();
    await rm(root, { force: true, recursive: true });
  });
  await mkdir(path.join(root, 'Trips'));
  watchFolder(root, controller.signal, (changes) => reports.push(changes));
  // Watching starts asynchronously on some platforms.
  await new Promise((resolve) => {
    setTimeout(resolve, 200);
  });
  return { reports, root };
}

test('reports changes in nested folders by entry and parent, in batches', async () => {
  const { reports, root } = await watched();
  await writeFile(path.join(root, 'Trips', 'a.jpg'), '');
  await writeFile(path.join(root, 'Trips', 'b.jpg'), '');
  await vi.waitFor(
    () => {
      const changed = reports.flatMap((report) => report.changed);
      expect(changed).toContainEqual({ id: path.join('Trips', 'a.jpg'), parentId: 'Trips' });
      expect(changed).toContainEqual({ id: path.join('Trips', 'b.jpg'), parentId: 'Trips' });
    },
    { timeout: 5000 },
  );
  expect(reports.length).toBeLessThan(3);
  expect(reports.every((report) => !report.everything)).toBe(true);
});

test('skips the metadata files the system writes', async () => {
  const { reports, root } = await watched();
  await writeFile(path.join(root, '.DS_Store'), '');
  await writeFile(path.join(root, 'photo.jpg'), '');
  await vi.waitFor(
    () =>
      expect(reports.flatMap((report) => report.changed.map((change) => change.id))).toContain(
        'photo.jpg',
      ),
    { timeout: 5000 },
  );
  expect(reports.flatMap((report) => report.changed.map((change) => change.id))).not.toContain(
    '.DS_Store',
  );
});
