import { plan, tree } from '#__tests__/trash-fixtures';
import { filesOf } from '#trash-files';
import type { TrashFile } from '@prism/shared';
import { expect, test } from 'vitest';

const ENTRIES = tree(
  'bad ★1 !',
  'bad/best ★4',
  'bad/best/a.jpg',
  'bad/good.jpg ★5',
  'bad/good.xmp',
  'bad/plain.jpg',
  'poor.jpg ★1 !',
  'poor.xmp',
  'fine.jpg ★4',
);

/** Each file as `id`, with its owner or where it moves to. */
const listed = (files: TrashFile[]) =>
  files.map(({ entry, owner, to }) =>
    [entry.id, owner && `of ${owner}`, to && `to ${to}`].filter(Boolean).join(' '),
  );

test('every entry that goes is listed, inside folders that go too, and sidecars say whose', () => {
  const files = filesOf('.', ENTRIES, plan(ENTRIES, { decisions: { 'bad/best': 'trash' } }));
  // The 5-star photo keeps its folder, so what else is inside goes one by one.
  expect(listed(files.trashed)).toEqual([
    'bad/best',
    'bad/best/a.jpg',
    'bad/plain.jpg',
    'poor.jpg',
    'poor.xmp of poor.jpg',
  ]);
  expect(files.moved).toEqual([]);
});

test('what is rescued is listed once, where it moves to, and its folder goes whole', () => {
  const decided = plan(ENTRIES, { decisions: { 'bad/best': 'trash', 'bad/good.jpg': 'rescue' } });
  const files = filesOf('.', ENTRIES, decided);
  expect(listed(files.trashed)).toEqual([
    'bad',
    'bad/best',
    'bad/best/a.jpg',
    'bad/plain.jpg',
    'poor.jpg',
    'poor.xmp of poor.jpg',
  ]);
  expect(listed(files.moved)).toEqual(['bad/good.jpg to .', 'bad/good.xmp of good.jpg to .']);
});
