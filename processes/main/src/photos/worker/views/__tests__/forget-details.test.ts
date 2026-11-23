import {
  fixture,
  jpeg,
  openLibrary,
  SETTLED,
} from '#photos/worker/views/__tests__/library-fixtures';
import { prepareIndex } from '@prism/catalog';
import { utimes } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, vi } from 'vitest';

test('forgetting every photo’s details reads them again, and the views show what they read', async () => {
  const root = await fixture();
  const file = path.join(root, 'a.jpg');
  await jpeg(file, 'EOS R5');
  // A whole second, which setting the time again after the edit keeps exactly.
  const modified = new Date('2024-01-01T00:00:00Z');
  await utimes(file, modified, modified);
  const { library, open, stateOf } = await openLibrary(root);
  const viewId = await open();
  await vi.waitFor(
    () => expect(stateOf(viewId)).toMatchObject({ count: 1, loading: false, unread: 0 }),
    SETTLED,
  );
  const cameras = async () =>
    (await library.views.facets(viewId)).fields.camera.map(({ value }) => value);
  expect(await cameras()).toEqual(['Canon EOS R5']);
  // An edit that keeps the file's modified time, which the catalog can't tell from no edit.
  await jpeg(file, 'EOS R6');
  await utimes(file, modified, modified);
  const { version } = stateOf(viewId);

  await library.views.forgetDetails();

  await vi.waitFor(async () => {
    expect(stateOf(viewId).version).toBeGreaterThan(version);
    expect(stateOf(viewId)).toMatchObject({ unread: 0 });
    expect(await cameras()).toEqual(['Canon EOS R6']);
  }, SETTLED);
});

test('a forget the app quit during is carried on as the library opens again', async () => {
  const root = await fixture();
  const file = path.join(root, 'a.jpg');
  await jpeg(file, 'EOS R5');
  // A whole second, which setting the time again after the edit keeps exactly.
  const modified = new Date('2024-01-01T00:00:00Z');
  await utimes(file, modified, modified);
  const index = prepareIndex(path.join(await fixture(), 'index.db'));
  const before = await openLibrary(root, index);
  const first = await before.open();
  await vi.waitFor(
    () => expect(before.stateOf(first)).toMatchObject({ count: 1, loading: false, unread: 0 }),
    SETTLED,
  );
  await before.library.close();
  await jpeg(file, 'EOS R6');
  await utimes(file, modified, modified);
  // As the catalog is left when the app quits before a forget's first batch.
  const catalog = new DatabaseSync(index);
  catalog.exec('INSERT INTO forget_progress (id, done_through) VALUES (1, 0)');
  catalog.close();

  const { library, open, stateOf } = await openLibrary(root, index);
  const viewId = await open();

  await vi.waitFor(async () => {
    expect(stateOf(viewId)).toMatchObject({ count: 1, loading: false, unread: 0 });
    const { fields } = await library.views.facets(viewId);
    expect(fields.camera.map(({ value }) => value)).toEqual(['Canon EOS R6']);
  }, SETTLED);
});
