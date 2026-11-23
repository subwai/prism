import { INDEX_FILE_NAME, RATINGS_FILE_NAME } from '@prism/catalog';
import { app } from 'electron';
import path from 'node:path';

/** Where every folder's worker keeps what it read from photos, shared between them. */
export function photoIndexFile(): string {
  return path.join(app.getPath('userData'), INDEX_FILE_NAME);
}

/**
 * Where every folder's worker keeps the ratings of folders and videos, which photos keep in
 * their own files. Unlike the index, it is no cache.
 */
export function ratingsFile(): string {
  return path.join(app.getPath('userData'), RATINGS_FILE_NAME);
}
