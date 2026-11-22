import { details, entry, filtered, openCatalog, spec } from '#__tests__/fixtures';
import { rateStored } from '#stored-ratings';
import { rowsOf } from '#trash/__tests__/trash-fixtures';
import { defaultTrashChoices } from '@prism/shared';
import { expect, test } from 'vitest';

test('a view’s plan matches as the view does, with ratings from both places', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      entries: [
        entry('bad'),
        entry('bad/good.jpg'),
        entry('bad/clip.mov', { kind: 'video' }),
        entry('poor.jpg'),
        entry('fine.jpg'),
      ],
      kind: 'list',
    },
    {
      details: [
        details('bad/good.jpg', { rating: 5 }),
        details('poor.jpg', { rating: 2 }),
        details('fine.jpg', { rating: 4 }),
      ],
      kind: 'storeDetails',
    },
  ]);
  rateStored(catalog.stored, 'bad', 1);
  rateStored(catalog.stored, 'bad/clip.mov', 1);
  catalog.touch();
  const views = catalog.views();
  const { version } = views.openNow(
    'trash',
    spec({ recursive: true, ...filtered({ rating: ['max2'] }) }),
  );
  const result = views.trashPlan('trash', version, defaultTrashChoices());
  expect(result && rowsOf(result)).toEqual([
    ['.', ['bad trash', 'poor.jpg trash']],
    ['bad', ['bad/good.jpg keep']],
  ]);
  expect(result?.targets).toEqual(['bad/clip.mov', 'poor.jpg']);
  expect(views.trashPlan('trash', version + 1, defaultTrashChoices())).toBeNull();
});

test('a search matches folders by name, and filters that folders lack match none', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      entries: [entry('tmp'), entry('tmp/a.jpg'), entry('tmp/b.jpg'), entry('c.jpg')],
      kind: 'list',
    },
    {
      details: [
        details('tmp/a.jpg', { rating: 5 }),
        details('c.jpg', { camera: 'X100V', tags: ['beach', 'sea'] }),
      ],
      kind: 'storeDetails',
    },
  ]);
  const views = catalog.views();
  const search = views.openNow('search', spec({ recursive: true, search: 'tmp' }));
  const searched = views.trashPlan('search', search.version, defaultTrashChoices());
  expect(searched && rowsOf(searched)).toEqual([
    ['.', ['tmp trash']],
    ['tmp', ['tmp/a.jpg keep']],
  ]);
  expect(searched?.targets).toEqual(['tmp/b.jpg']);
  const camera = views.openNow(
    'camera',
    spec({ recursive: true, ...filtered({ camera: ['X100V'] }) }),
  );
  const byCamera = views.trashPlan('camera', camera.version, defaultTrashChoices());
  expect(byCamera?.targets).toEqual(['c.jpg']);
  // Rows carry the details the sheet filters them by, as the gallery's search does.
  expect(byCamera?.groups[0]?.rows[0]?.entry.exif).toEqual({
    camera: 'X100V',
    tags: ['beach', 'sea'],
  });
});
