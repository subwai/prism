import { ancestorsOf, treeRows, withOpened } from '#components/folder-tree/tree-rows';
import { EMPTY_TREE, foldersInside, withSkeleton } from '#data/folder-skeleton';
import { folderAt } from '#data/trails';
import { largeSkeleton } from './skeletons.ts';
import { type PhotoFolder, treeListingFromText } from '@prism/shared';
import { test } from 'vitest';

const root: PhotoFolder = { id: '.', name: 'Pictures' };
const deepest = 'Photos 2029/39 Event/2019-05-35 Holiday trip';

// What the window does with a large library's skeleton as it reads it, in the one task that ends
// with the tree on screen: run with `vitest bench`.
test("a large library's skeleton", async ({ bench }) => {
  const text = largeSkeleton();
  const skeleton = treeListingFromText(text);
  const tree = withSkeleton(EMPTY_TREE, skeleton);
  await bench.compare(
    bench('parsed', () => {
      treeListingFromText(text);
    }),
    bench('made a tree', () => {
      withSkeleton(EMPTY_TREE, skeleton);
    }),
    bench('a folder found by ID', () => {
      folderAt(tree, deepest);
    }),
    bench("the tree's rows", () => {
      treeRows(tree, root, [root]);
    }),
    bench('all of it', () => {
      const read = withSkeleton(EMPTY_TREE, treeListingFromText(text));
      folderAt(read, deepest);
      treeRows(read, root, [root]);
    }),
  );
});

// What opening or closing a folder does in its click, in a large library: the tree remembers
// what differs from how it starts, and an earlier session's file may have every folder closed,
// as Collapse All after Expand All left it before.
test('a folder opened or closed in a large library', async ({ bench }) => {
  const tree = withSkeleton(EMPTY_TREE, treeListingFromText(largeSkeleton()));
  const ancestors = ancestorsOf(root, [root]);
  const saved = new Map(foldersInside(tree, root.id).map((id): [string, boolean] => [id, false]));
  const pruned = withOpened(saved, [], ancestors);
  let open = false;
  await bench.compare(
    bench('first, with every folder remembered closed', () => {
      open = !open;
      const opened = withOpened(saved, [['Photos 2001', open]], ancestors);
      treeRows({ ...tree, opened }, root, [root]);
    }),
    bench('after', () => {
      open = !open;
      const opened = withOpened(pruned, [['Photos 2001', open]], ancestors);
      treeRows({ ...tree, opened }, root, [root]);
    }),
  );
});
