import { refusalMessages } from '#photos/worker/disk/refusal-messages';
import { writeRating } from '@prism/media';
import { errorMessage, type Rating } from '@prism/shared';
import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';

const FAILURE_MESSAGES = refusalMessages('change');

/** The photo file's size and times, from just before and just after its rating was written. */
export interface RatingRewrite {
  before: Stats;
  after: Stats;
}

/** Writes `stars` into the photo at `file`, saying why in words if the system refuses. */
async function writeRatingOrExplain(file: string, stars: Rating | null) {
  try {
    await writeRating(file, stars);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    throw new Error(FAILURE_MESSAGES[code] ?? `It could not be rated: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/**
 * Writes `stars` into the photo at `file`, or with `null` takes its rating out. Returns the file
 * as it was before and after, which name its thumbnail before and after the rewrite.
 */
export async function writeRatingIntoFile(
  file: string,
  stars: Rating | null,
): Promise<RatingRewrite> {
  const before = await stat(file);
  await writeRatingOrExplain(file, stars);
  const after = await stat(file);
  return { after, before };
}
