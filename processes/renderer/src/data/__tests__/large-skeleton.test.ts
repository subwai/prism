import { EMPTY_TREE, subfoldersIn, withSkeleton } from '#data/folder-skeleton';
import { largeSkeleton } from './skeletons.ts';
import { decodeTreeListing } from '@prism/shared';
import { expect, test, vi } from 'vitest';

test("a large library's skeleton is applied without parsing its covers, then a tile's at a time", () => {
  const text = largeSkeleton();
  const parse = vi.spyOn(JSON, 'parse');
  const tree = withSkeleton(EMPTY_TREE, decodeTreeListing(text));
  // The folders alone, a fifth of the text, in one go.
  expect(parse).toHaveBeenCalledOnce();
  expect(String(parse.mock.calls[0]?.[0]).length).toBeLessThan(text.length / 4);
  expect([...tree.children.values()].flat()).toHaveLength(44_430);

  // The tiles on show read their own covers, and only once.
  parse.mockClear();
  const [first, second] = subfoldersIn(tree, '.');
  expect(first?.summary?.covers).toHaveLength(0);
  expect(second?.summary?.covers.map((cover) => cover.name)).toEqual([
    'DSC_000004 edited.JPG',
    'DSC_000005 edited.JPG',
    'DSC_000006 edited.JPG',
    'DSC_000007 edited.JPG',
  ]);
  expect(second?.summary?.covers).toBe(second?.summary?.covers);
  expect(parse).toHaveBeenCalledOnce();
  parse.mockRestore();
});
