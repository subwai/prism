import { details, entry, filtered, openCatalog, spec } from '#__tests__/fixtures';
import { rowsOf } from '#__tests__/trash-fixtures';
import { rateStored } from '#stored-ratings';
import { noTrashChoices } from '@prism/shared';
import { expect, test } from 'vitest';

test('a view’s plan matches as the view does, with ratings from both places', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      listed: [
        entry('bad'),
        entry('bad/good.jpg'),
        entry('bad/clip.mov', { kind: 'video' }),
        entry('poor.jpg'),
        entry('fine.jpg'),
      ],
    },
    {
      details: [
        details('bad/good.jpg', { rating: 5 }),
        details('poor.jpg', { rating: 2 }),
        details('fine.jpg', { rating: 4 }),
      ],
    },
  ]);
  rateStored(catalog.stored, 'bad', 1);
  rateStored(catalog.stored, 'bad/clip.mov', 1);
  catalog.touch();
  const views = catalog.views();
  const { version } = views.open(
    'trash',
    spec({ recursive: true, ...filtered({ rating: ['max2'] }) }),
  );
  const result = views.trashPlan('trash', version, noTrashChoices());
  expect(result && rowsOf(result)).toEqual([
    ['.', ['bad trash', 'poor.jpg trash']],
    ['bad', ['bad/good.jpg keep']],
  ]);
  expect(result?.targets).toEqual(['bad/clip.mov', 'poor.jpg']);
  expect(views.trashPlan('trash', version + 1, noTrashChoices())).toBeNull();
});

test('a search matches folders by name, and filters that folders lack match none', () => {
  const catalog = openCatalog();
  catalog.write([
    { listed: [entry('tmp'), entry('tmp/a.jpg'), entry('tmp/b.jpg'), entry('c.jpg')] },
    {
      details: [
        details('tmp/a.jpg', { rating: 5 }),
        details('c.jpg', { camera: 'X100V', tags: ['beach', 'sea'] }),
      ],
    },
  ]);
  const views = catalog.views();
  const search = views.open('search', spec({ recursive: true, search: 'tmp' }));
  const searched = views.trashPlan('search', search.version, noTrashChoices());
  expect(searched && rowsOf(searched)).toEqual([
    ['.', ['tmp trash']],
    ['tmp', ['tmp/a.jpg keep']],
  ]);
  expect(searched?.targets).toEqual(['tmp/b.jpg']);
  const camera = views.open(
    'camera',
    spec({ recursive: true, ...filtered({ camera: ['X100V'] }) }),
  );
  const byCamera = views.trashPlan('camera', camera.version, noTrashChoices());
  expect(byCamera?.targets).toEqual(['c.jpg']);
  // Rows carry the details the sheet filters them by, as the gallery's search does.
  expect(byCamera?.groups[0]?.rows[0]?.entry.exif).toEqual({
    camera: 'X100V',
    tags: ['beach', 'sea'],
  });
});
