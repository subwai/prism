import { openDatabase } from '#photos/__tests__/catalog-fixtures';
import { cacheRead, type PhotoFile, recallExif } from '#photos/catalog/cached-details';
import { catalogDatabase } from '#photos/catalog/data/database';
import { expect, test } from 'vitest';

function photo(file: string, overrides: Partial<PhotoFile> = {}): PhotoFile {
  return { file, id: file, identity: '1:10', modifiedMs: 1000, size: 50, ...overrides };
}

test('cached details count only while the file is as they were read', () => {
  const db = catalogDatabase(openDatabase());
  cacheRead(db, { ...photo('/a.jpg'), exif: { camera: 'Canon EOS R5' } });
  expect(recallExif(db, photo('/a.jpg'))).toEqual({ camera: 'Canon EOS R5' });
  expect(recallExif(db, photo('/a.jpg', { modifiedMs: 2000 }))).toBeUndefined();
  expect(recallExif(db, photo('/a.jpg', { size: 51 }))).toBeUndefined();
});

test('a renamed file is found by its place on disk, and its details move with it', () => {
  const db = catalogDatabase(openDatabase());
  cacheRead(db, { ...photo('/a.jpg'), exif: { iso: 400 } });
  expect(recallExif(db, photo('/b.jpg'))).toEqual({ iso: 400 });
  expect(recallExif(db, photo('/a.jpg', { identity: '1:11' }))).toBeUndefined();
  expect(recallExif(db, photo('/b.jpg', { identity: null }))).toEqual({ iso: 400 });
});
