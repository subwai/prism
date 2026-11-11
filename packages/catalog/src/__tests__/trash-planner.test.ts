import { plan, rowAt, rowsOf, tree } from '#__tests__/trash-fixtures';
import { expect, test } from 'vitest';

test('matching photos and videos go, grouped by their folders in order', () => {
  const result = plan(
    tree(
      'a',
      'b',
      'top.jpg ★1 !',
      'keep.jpg',
      'a/one.jpg ★2 !',
      'a/two.mov ★1 !',
      'a/stay.jpg ★5',
      'b/three.jpg ★1 !',
      'b/stay.jpg',
    ),
  );
  expect(rowsOf(result)).toEqual([
    ['a', ['a/one.jpg trash', 'a/two.mov trash']],
    ['b', ['b/three.jpg trash']],
    ['.', ['top.jpg trash']],
  ]);
  expect(rowAt(result, 'a/one.jpg')).toMatchObject({
    options: ['keep', 'trash'],
    reason: 'matches',
  });
  expect(result.targets).toEqual(['a/one.jpg', 'a/two.mov', 'b/three.jpg', 'top.jpg']);
  expect(result.totals).toEqual({ files: 0, folders: 0, photos: 3, size: 40, videos: 1 });
});

test('a matching folder goes with everything inside it, rated or not', () => {
  const result = plan(
    tree(
      'bad ★1 !',
      'bad/inner',
      'bad/inner/deep.jpg',
      'bad/one.jpg ★1 !',
      'bad/plain.jpg',
      'bad/notes.txt',
    ),
  );
  expect(result.targets).toEqual(['bad']);
  expect(rowsOf(result)).toEqual([['.', ['bad trash']]]);
  expect(rowAt(result, 'bad')).toMatchObject({
    conflicts: 0,
    contents: { files: 1, folders: 2, photos: 3, size: 60, videos: 0 },
    options: ['keep', 'only', 'trash'],
  });
});

const CONFLICTED = [
  'bad ★1 !',
  'bad/best ★4',
  'bad/best/a.jpg',
  'bad/rest',
  'bad/rest/b.jpg',
  'bad/good.jpg ★5',
  'bad/good.xmp',
  'bad/poor.jpg ★1 !',
  'bad/plain.jpg',
  'bad/notes.txt',
];

test('what is rated higher inside a matching folder is a row of its own, kept by default', () => {
  const kept = plan(tree(...CONFLICTED));
  expect(rowsOf(kept)).toEqual([
    ['.', ['bad trash']],
    ['bad', ['bad/best keep', 'bad/good.jpg keep']],
  ]);
  expect(rowAt(kept, 'bad')).toMatchObject({
    conflicts: 2,
    contents: { files: 1, folders: 1, photos: 3 },
  });
  expect(rowAt(kept, 'bad/good.jpg')).toMatchObject({
    options: ['keep', 'rescue', 'trash'],
    reason: 'conflict',
    rescueTo: '.',
  });
  // The folder stays with what it keeps; the rest goes, a folder at a time where it can.
  expect(kept.targets).toEqual(['bad/rest', 'bad/poor.jpg', 'bad/plain.jpg', 'bad/notes.txt']);

  const trashed = plan(tree(...CONFLICTED), { defaults: { conflict: 'trash' } });
  expect(rowsOf(trashed)).toEqual([
    ['.', ['bad trash']],
    ['bad', ['bad/best trash', 'bad/good.jpg trash']],
  ]);
  expect(trashed.targets).toEqual(['bad']);
  expect(trashed.totals).toMatchObject({ files: 2, folders: 3, photos: 5 });
});

test('a conflict rescued moves up out of the matching folder, with its sidecar', () => {
  const rescued = plan(tree(...CONFLICTED), { decisions: { 'bad/good.jpg': 'rescue' } });
  expect(rowsOf(rescued)).toContainEqual(['bad', ['bad/best keep', 'bad/good.jpg rescue*']]);
  expect(rowAt(rescued, 'bad/good.jpg')?.attachments).toEqual(['bad/good.xmp']);
  expect(rescued.moves).toEqual([
    { id: 'bad/good.jpg', to: '.' },
    { id: 'bad/good.xmp', to: '.' },
  ]);
  expect(rescued.rescued).toMatchObject({ files: 1, photos: 1 });

  // With nothing else kept, the folder goes once what is rescued has moved out.
  const emptied = plan(tree(...CONFLICTED), {
    decisions: { 'bad/best': 'trash', 'bad/good.jpg': 'rescue' },
  });
  expect(emptied.targets).toEqual(['bad']);
  expect(emptied.moves).toHaveLength(2);
});

test('a folder kept as a conflict keeps its own matches unless decided otherwise', () => {
  const entries = tree(
    'bad ★1 !',
    'bad/best ★4',
    'bad/best/worse ★1 !',
    'bad/best/worse/x.jpg',
    'bad/best/poor.jpg ★2 !',
    'bad/best/plain.jpg',
  );
  const kept = plan(entries);
  expect(rowsOf(kept)).toEqual([
    ['.', ['bad trash']],
    ['bad', ['bad/best keep']],
    ['bad/best', ['bad/best/worse keep', 'bad/best/poor.jpg keep']],
  ]);
  expect(rowAt(kept, 'bad/best/worse')).toMatchObject({ reason: 'inside' });
  expect(kept.targets).toEqual([]);

  const inside = plan(entries, { defaults: { inside: 'trash' } });
  expect(inside.targets).toEqual(['bad/best/worse', 'bad/best/poor.jpg']);
});

test('only the matches inside a matching folder go, if the person says so', () => {
  const result = plan(tree('bad ★1 !', 'bad/poor.jpg ★1 !', 'bad/plain.jpg', 'bad/good.jpg ★5'), {
    decisions: { bad: 'only' },
  });
  expect(rowsOf(result)).toEqual([
    ['.', ['bad only*']],
    ['bad', ['bad/poor.jpg trash']],
  ]);
  expect(result.targets).toEqual(['bad/poor.jpg']);
  // Then the folder goes too only if that leaves it empty.
  expect(plan(tree('bad ★1 !', 'bad/x.jpg ★1 !'), { decisions: { bad: 'only' } }).targets).toEqual([
    'bad',
  ]);
});

test('a folder that everything inside is leaving goes too, from the deepest up', () => {
  const entries = tree(
    'trip',
    'trip/day',
    'trip/day/a.jpg ★1 !',
    'trip/day/a.xmp',
    'trip/day/._a.jpg',
    'trip/day/._gone.jpg',
    'trip/b.jpg ★2 !',
  );
  const result = plan(entries);
  expect(rowsOf(result)).toEqual([['.', ['trip trash']]]);
  expect(rowAt(result, 'trip')).toMatchObject({
    contents: { files: 3, folders: 2, photos: 2 },
    reason: 'empty',
  });
  expect(result.targets).toEqual(['trip']);

  // Kept, an emptied folder stays, but what is inside it still goes.
  const kept = plan(entries, { defaults: { empty: 'keep' } });
  expect(rowsOf(kept)).toEqual([
    ['trip', ['trip/day keep', 'trip/b.jpg trash']],
    ['trip/day', ['trip/day/a.jpg trash']],
  ]);
  expect(kept.targets).toEqual([
    'trip/day/a.jpg',
    'trip/day/a.xmp',
    'trip/day/._a.jpg',
    'trip/b.jpg',
  ]);
});

test('files that keep a folder from being left empty are rows of their own, kept by default', () => {
  const entries = tree(
    'kept ★4',
    'notes',
    'kept/a.jpg ★1 !',
    'notes/b.jpg ★1 !',
    'notes/b.jpg.xmp',
    'notes/readme.txt',
    'notes/raw.cr2',
  );
  const result = plan(entries);
  expect(rowsOf(result)).toEqual([
    ['kept', ['kept/a.jpg trash']],
    ['notes', ['notes/b.jpg trash', 'notes/readme.txt keep', 'notes/raw.cr2 keep']],
  ]);
  expect(rowAt(result, 'notes/b.jpg')?.attachments).toEqual(['notes/b.jpg.xmp']);
  expect(rowAt(result, 'notes/raw.cr2')?.reason).toBe('leftover');
  expect(result.targets).toEqual(['kept/a.jpg', 'notes/b.jpg', 'notes/b.jpg.xmp']);

  // Trashed, they let it be left empty; a rated folder never is.
  const trashed = plan(entries, { defaults: { leftover: 'trash' } });
  expect(rowsOf(trashed)).toEqual([
    ['kept', ['kept/a.jpg trash']],
    ['.', ['notes trash']],
  ]);
  expect(trashed.targets).toEqual(['kept/a.jpg', 'notes']);
});

test('a sidecar stays with a photo that stays', () => {
  const result = plan(tree('bad ★1 !', 'bad/good.jpg ★5', 'bad/GOOD.XMP', 'bad/poor.jpg'));
  expect(result.targets).toEqual(['bad/poor.jpg']);
});

test('a match kept keeps everything it stands for', () => {
  const entries = tree(
    'bad ★1 !',
    'trip',
    'bad/x.jpg ★1 !',
    'trip/a.jpg ★1 !',
    'trip/b.jpg ★1 !',
    'c.jpg ★1 !',
  );
  const result = plan(entries, {
    decisions: { bad: 'keep', 'c.jpg': 'keep', 'trip/a.jpg': 'keep', 'trip/b.jpg': 'trash' },
  });
  // Deciding what is already the default changes nothing.
  expect(rowsOf(result)).toEqual([
    ['.', ['bad keep*', 'c.jpg keep*']],
    ['trip', ['trip/a.jpg keep*', 'trip/b.jpg trash']],
  ]);
  // Its one photo kept, `trip` is no longer left empty.
  expect(result.targets).toEqual(['trip/b.jpg']);
});

test('a plan is of the inside of its folder, which never goes itself', () => {
  const result = plan(tree('a', 'a/b', 'a/b/x.jpg ★1 !', 'a/y.jpg ★1 !'), {}, 'a');
  expect(rowsOf(result)).toEqual([['a', ['a/b trash', 'a/y.jpg trash']]]);
  expect(result.targets).toEqual(['a/b', 'a/y.jpg']);
});
