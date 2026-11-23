import type { CatalogDatabase } from '#database/catalog-database';
import {
  clearForgetProgress,
  readForgetProgress,
  startForgetProgress,
  storeForgetProgress,
} from '#repositories/forget-progress';
import { deleteTagsBetween } from '#repositories/item-tags';
import { forgetDetailsBetween } from '#repositories/items/details';
import { largestItemNumber } from '#repositories/items/filters';
import { dropRemovedDetails } from '#repositories/removed-details';
import type { ForgetProgress } from '@prism/shared';

/**
 * How many entry numbers one batch of a forget goes through. Each batch is a write of its own, so
 * the indexer's writes go in between. On a catalog of 1.75M photos, 114k of them with details
 * read, the 110 batches took 1.4 ms at the median and 231 ms at most, where forgetting them all
 * in one write took 0.7 s.
 */
export const FORGET_BATCH_SIZE = 20_000;

/**
 * Starts forgetting every photo's details, from the first entry, and drops the details removed
 * rows left. A forget already under way starts over.
 */
export function startForgettingDetails(db: CatalogDatabase): void {
  dropRemovedDetails(db);
  startForgetProgress(db);
}

/**
 * Forgets the details and tags of the next batch of entries, if a forget is under way, and notes
 * how far it got, or that it is done.
 */
export function forgetNextBatch(db: CatalogDatabase): void {
  const after = readForgetProgress(db);
  if (after === null) {
    return;
  }
  const through = after + FORGET_BATCH_SIZE;
  forgetDetailsBetween(db, after, through);
  deleteTagsBetween(db, after, through);
  if (through >= largestItemNumber(db)) {
    clearForgetProgress(db);
  } else {
    storeForgetProgress(db, through);
  }
}

/** How far the forget under way has got, by entry number, or `null` if none is under way. */
export function forgetStatus(db: CatalogDatabase): ForgetProgress | null {
  const done = readForgetProgress(db);
  return done === null ? null : { done, total: largestItemNumber(db) };
}
