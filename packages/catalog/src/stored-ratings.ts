import type { CatalogDatabase } from '#data/database';
import { among } from '#data/items';
import {
  moveRatings,
  ratingsAt,
  type RatingsDatabase,
  ratingsInside,
  storeRating,
  unstoreRating,
} from '#data/ratings';
import type { Scope } from '#data/scope';
import { type PhotoEntry, ratesInFile, type Rating } from '@prism/shared';
import path from 'node:path';

/** The ratings file, and the library's folder, whose entries' paths it keeps ratings by. */
export interface StoredRatings {
  db: RatingsDatabase;
  root: string;
}

/** Where the entry `id` is on disk; IDs are paths relative to the library's folder. */
function pathOf(root: string, id: string) {
  return id === '.' ? root : path.join(root, id);
}

/** The ID of the entry at `file`, inside the library's folder. */
function idOf(root: string, file: string) {
  return file === root ? '.' : path.relative(root, file);
}

/** The ratings kept of entries inside the library, by ID. */
function keptInside({ db, root }: StoredRatings): Map<string, Rating> {
  return new Map(
    ratingsInside(db, root).map(({ path: file, rating }) => [idOf(root, file), rating]),
  );
}

/**
 * `entries` with the ratings the ratings file keeps of those that keep none in a file of their
 * own, such as folders and videos.
 */
export function withStoredRatings(stored: StoredRatings, entries: PhotoEntry[]): PhotoEntry[] {
  const unrated = entries.filter((entry) => !ratesInFile(entry));
  if (unrated.length === 0) {
    return entries;
  }
  const kept = new Map(
    ratingsAt(
      stored.db,
      unrated.map((entry) => pathOf(stored.root, entry.id)),
    ).map(({ path: file, rating }) => [idOf(stored.root, file), rating]),
  );
  return entries.map((entry) => {
    const rating = ratesInFile(entry) ? undefined : kept.get(entry.id);
    return rating === undefined ? entry : { ...entry, rating };
  });
}

/** The entries the ratings file rates at least `stars`, by number, in any scope. */
export function storedAtLeast(
  db: CatalogDatabase,
  library: number,
  stored: StoredRatings,
  stars: number,
): number[] {
  const ids = [...keptInside(stored)].filter(([, rating]) => rating >= stars).map(([id]) => id);
  if (ids.length === 0) {
    return [];
  }
  return among(db, library, { directoryId: '.', recursive: true }, ids)
    .filter((entry) => !ratesInFile(entry))
    .map((entry) => entry.item);
}

/** How many entries of `scope` the ratings file rates each number of stars. */
export function countStored(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  stored: StoredRatings,
): { rating: number; count: number }[] {
  const kept = keptInside(stored);
  const counts = new Map<number, number>();
  if (kept.size === 0) {
    return [];
  }
  for (const entry of among(db, library, scope, [...kept.keys()])) {
    const rating = kept.get(entry.id);
    if (rating !== undefined && !ratesInFile(entry)) {
      counts.set(rating, (counts.get(rating) ?? 0) + 1);
    }
  }
  return [...counts].map(([rating, count]) => ({ count, rating }));
}

/** Keeps the rating of the entry `id`, or with `null` forgets it. */
export function rateStored(stored: StoredRatings, id: string, rating: Rating | null): void {
  const file = pathOf(stored.root, id);
  if (rating === null) {
    unstoreRating(stored.db, file);
  } else {
    storeRating(stored.db, { path: file, ratedMs: Date.now(), rating });
  }
}

/** Moves the ratings kept of the entry `from`, and everything inside it, to `to`. */
export function moveStored(stored: StoredRatings, from: string, to: string): void {
  moveRatings(stored.db, pathOf(stored.root, from), pathOf(stored.root, to));
}
