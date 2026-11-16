import { treeRows } from '#components/folder-tree/tree-rows';
import { EMPTY_TREE, withSkeleton } from '#data/folder-skeleton';
import { folderAt } from '#data/trails';
import { largeSkeleton } from './skeletons.ts';
import { type PhotoFolder, skeletonFromText } from '@prism/shared';
import { test } from 'vitest';

const root: PhotoFolder = { id: '.', name: 'Pictures' };
const deepest = 'Photos 2029/39 Event/2019-05-35 Holiday trip';

// What the window does with a large library's skeleton as it reads it, in the one task that ends
// with the tree on screen: run with `vitest bench`.
test("a large library's skeleton", async ({ bench }) => {
  const text = largeSkeleton();
  const skeleton = skeletonFromText(text);
  const tree = withSkeleton(EMPTY_TREE, skeleton);
  await bench.compare(
    bench('parsed', () => {
      skeletonFromText(text);
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
      const read = withSkeleton(EMPTY_TREE, skeletonFromText(text));
      folderAt(read, deepest);
      treeRows(read, root, [root]);
    }),
  );
});
