import { keepThumbnail, temporaryFile, type ThumbnailCache } from '#thumbnails/cache';
import { EFFORT, QUALITY, THUMBNAIL_EDGE, type ThumbnailSource } from '#thumbnails/thumbnail-key';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import sharp, { type SharpOptions } from 'sharp';

// `stat` reads what the disk records of a file: its size, its times and its number on the disk.

/**
 * How photos are decoded: those over 100 megapixels are refused, and a damaged one shows what
 * can be read of it, as Chromium shows a JPEG cut short. Sharp's default fails on any warning,
 * and libvips warns of a truncated JPEG, so such a photo had no thumbnail at all.
 */
export const DECODING: SharpOptions = { failOn: 'none', limitInputPixels: 100_000_000 };

/** Renders a still image of a video or photo as an encoded image, about `size` pixels. */
export type StillImageReader = (
  source: string,
  size: { width: number; height: number },
  signal: AbortSignal,
) => Promise<Uint8Array>;

/**
 * Runs a thumbnail's `decode` in its decode slot, which a caller limits apart from the file's read,
 * as decodes wear on the CPU and reads wait on the disk or share.
 */
export type DecodeSlot = <Value>(decode: () => Promise<Value>) => Promise<Value>;

// Image-level parallelism is bounded separately by the worker's scheduler; see `THREAD_POOL_SIZE`.
// More threads per image measured no faster, as decoding a shrunk JPEG uses one anyway.
sharp.concurrency(1);
// Every thumbnail reads a different file, so the cache rarely helps; holding no files open
// leaves them free to rename, move to the Trash or unmount.
sharp.cache({ files: 0, items: 64, memory: 32 });

/** What to make a thumbnail of, and how. */
export interface ThumbnailRequest {
  source: ThumbnailSource;
  /** The thumbnail's name in the cache; see `thumbnailKey`. */
  key: string;
  signal: AbortSignal;
  /** Renders a still image to make the thumbnail of, for a video or a photo Sharp can't decode. */
  stillImage?: StillImageReader;
  /** Waits for a decode slot; without one, the decode runs at once. */
  decodeSlot?: DecodeSlot;
}

/** Shrinks the encoded image `input` into a WebP thumbnail at `file`. */
function encodeThumbnail(input: Uint8Array | undefined, file: string) {
  return (
    sharp(input, DECODING)
      .autoOrient()
      .resize({
        fit: 'inside',
        height: THUMBNAIL_EDGE,
        width: THUMBNAIL_EDGE,
        withoutEnlargement: true,
      })
      // Sharp converts to sRGB otherwise, so a wide-gamut photo's thumbnail looked duller than
      // the original the viewer swaps it for. Display P3 holds what phones and most cameras
      // capture, and its profile is only half a kilobyte.
      .withIccProfile('p3')
      .webp({ effort: EFFORT, quality: QUALITY })
      .toFile(file)
  );
}

/** Throws if `source` changed while its thumbnail was made, so the thumbnail is not kept. */
async function checkSourceUnchanged(source: ThumbnailSource) {
  const after = await stat(source.file);
  if (after.size !== source.info.size || after.mtimeMs !== source.info.mtimeMs) {
    throw new Error('Source changed during thumbnail generation; retry the request.');
  }
}

/**
 * Renders thumbnail `key` of `source`, or of the still image that `stillImage` reads from it. The
 * photo is read first, and decoded in the `decodeSlot` that follows; a still image is read and
 * decoded in the slot, as making one is work for the CPU too.
 */
export async function generateThumbnail(
  cache: ThumbnailCache,
  { source, key, signal, stillImage, decodeSlot = (decode) => decode() }: ThumbnailRequest,
): Promise<void> {
  signal.throwIfAborted();
  // Created for each write, as resetting the cache deletes the folder.
  await mkdir(cache.directory, { recursive: true });
  const temporary = temporaryFile(cache, key);
  try {
    // The photo is read whole before Sharp decodes it, rather than handed to Sharp by its path:
    // libvips reads a file a few kilobytes at a time, each a round trip to a network share, and
    // a JPEG's thumbnail from a share was made 3–7 times faster read whole.
    const read = stillImage ? undefined : await readFile(source.file, { signal });
    const { size } = await decodeSlot(async () => {
      signal.throwIfAborted();
      const input =
        read ??
        (await stillImage?.(
          source.file,
          { height: THUMBNAIL_EDGE, width: THUMBNAIL_EDGE },
          signal,
        ));
      return encodeThumbnail(input, temporary);
    });
    await checkSourceUnchanged(source);
    await keepThumbnail(cache, { key, size, temporary });
  } finally {
    await rm(temporary, { force: true });
  }
}
