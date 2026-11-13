import { convertHeif } from '#heif';
import { isOpaque } from '#opacity';
import { CONVERSION_CONCURRENCY } from '#threads';
import { DECODING, type ThumbnailSource } from '#thumbnails';
import { WorkQueue } from '#work-queue';
import { isHeif, needsConversion } from '@prism/shared';
import { LRUCache } from 'lru-cache';
import sharp from 'sharp';

const QUALITY = 90;
// A dozen or so 12-megapixel photos, enough to go back and forth between them.
const REMEMBERED_BYTES = 64 * 1024 * 1024;
const MAX_QUEUED = 64;

/** A full-size photo the window can show, and its media type. */
export interface ConvertedPhoto {
  data: Uint8Array;
  type: 'image/jpeg' | 'image/png';
}

/**
 * A full-size image of the TIFF photo `source`, which sharp decodes though Chromium does not.
 * It is turned upright, as the converted photo keeps no orientation, and is a PNG if it is
 * transparent, which a JPEG cannot be. Many TIFFs have an alpha channel that hides nothing,
 * so they are JPEGs too. It is in Display P3, which clips far less of a wide-gamut scan, such as
 * an Adobe RGB one, than sRGB does; see `generateThumbnail`.
 */
async function convertTiff(source: string, signal: AbortSignal): Promise<ConvertedPhoto> {
  const transparent = !(await isOpaque(sharp(source, DECODING)));
  const image = sharp(source, DECODING).autoOrient().withIccProfile('p3');
  signal.throwIfAborted();
  const converted = transparent
    ? { data: await image.png().toBuffer(), type: 'image/png' as const }
    : { data: await image.jpeg({ quality: QUALITY }).toBuffer(), type: 'image/jpeg' as const };
  signal.throwIfAborted();
  return converted;
}

async function convert(source: string, signal: AbortSignal): Promise<ConvertedPhoto> {
  if (isHeif(source)) {
    return { data: await convertHeif(source, signal), type: 'image/jpeg' };
  }
  return convertTiff(source, signal);
}

/**
 * Full-size conversions of the photos the viewer opens that the window cannot read itself; see
 * `needsConversion`. They are kept in memory rather than on disk, where they would crowd
 * thumbnails out of the cache's budget: a session converts each photo it opens once, until the
 * ones opened longest ago make room for new ones.
 */
export interface Conversions {
  /** Photos converted, by the file, its size and its modification time. */
  readonly photos: LRUCache<string, ConvertedPhoto>;
  /** Whether any conversion is queued or under way, as `queue.busy` says. */
  readonly queue: WorkQueue<ConvertedPhoto>;
}

/** Conversions that stop as `signal` aborts. */
export function conversions(signal: AbortSignal): Conversions {
  return {
    photos: new LRUCache({
      maxSize: REMEMBERED_BYTES,
      sizeCalculation: (photo) => Math.max(1, photo.data.byteLength),
    }),
    queue: new WorkQueue(CONVERSION_CONCURRENCY, MAX_QUEUED, signal),
  };
}

/** The conversion of `source`, converted again if it changed since it last was. */
export function convertedPhoto(
  { photos, queue }: Conversions,
  { file, info }: ThumbnailSource,
): Promise<ConvertedPhoto> {
  if (!needsConversion(file)) {
    return Promise.reject(new Error('Only HEIF and TIFF photos are converted.'));
  }
  const key = JSON.stringify([file, info.size, info.mtimeMs]);
  const known = photos.get(key);
  if (known) {
    return Promise.resolve(known);
  }
  return queue.run(key, async (signal) => {
    const photo = await convert(file, signal);
    photos.set(key, photo);
    return photo;
  });
}
