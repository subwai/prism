import { isRating, type Rating } from '@prism/shared';
import { ExifTool } from 'exiftool-vendored';
import path from 'node:path';

// A file's inode is its number on its disk, which a rename or move keeps.

// exifr reads XMP from these photos' files with the rest of their details; ExifTool reads it
// from the others, such as HEIC, AVIF and WebP, which exifr reads no XMP from.
const READ_WITH_EXIFR = new Set(['.jpeg', '.jpg', '.png', '.tif', '.tiff']);
// At most two ExifTool processes, started when first needed. Ratings are read or written one
// at a time, and without a cap the background reads of photos' details would start one for
// every core.
const MAX_PROCESSES = 2;

/**
 * ExifTool, which runs Perl processes of its own until it is closed. Each library worker needs
 * only one, so this module keeps it.
 */
let tool: ExifTool | null = null;

function exiftool() {
  tool ??= new ExifTool({ maxProcs: MAX_PROCESSES });
  return tool;
}

/** Stops ExifTool's processes, as the folder closes; the next call starts them again. */
export async function closeExifTool(): Promise<void> {
  const closing = tool;
  tool = null;
  await closing?.end();
}

/** A rating as XMP holds it, or as Windows writes it in EXIF: anything else is no rating. */
export function ratingFrom(value: unknown): Rating | undefined {
  const stars = typeof value === 'string' ? Number(value) : value;
  return isRating(stars) ? stars : undefined;
}

/** Whether the photo `file`'s rating comes with the rest of its details, or needs ExifTool. */
export function readsRatingWithExifr(file: string): boolean {
  return READ_WITH_EXIFR.has(path.extname(file).toLowerCase());
}

/** The rating the photo `file` keeps in XMP, read with ExifTool. */
export async function readRating(file: string): Promise<Rating | undefined> {
  const tags = await exiftool().read(file, { readArgs: ['-fast', '-XMP-xmp:Rating'] });
  return ratingFrom(tags.Rating);
}

/**
 * Writes `rating` into the photo `file`'s XMP, as `xmp:Rating`, or with `null` removes it.
 * Ratings Windows wrote in EXIF go, so no other app finds an old one there. The file is
 * rewritten in place, keeping its inode, Finder tags and creation date.
 */
export async function writeRating(file: string, rating: Rating | null): Promise<void> {
  await exiftool().write(
    file,
    {},
    {
      // Minor problems, such as a maker note ExifTool would rather not touch, are no reason
      // to leave the rating unwritten.
      ignoreMinorErrors: true,
      writeArgs: [
        `-XMP-xmp:Rating=${rating ?? ''}`,
        '-EXIF:Rating=',
        '-EXIF:RatingPercent=',
        '-XMP-microsoft:RatingPercent=',
        '-overwrite_original_in_place',
      ],
    },
  );
}
