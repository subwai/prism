import type { FrameReader, ThumbnailSource } from '#thumbnails';
import { WorkQueue } from '#work-queue';
import { HEIF_CODECS_MISSING } from '@prism/shared';
import { convertToJpeg } from '@prism/windows-imaging';
import { LRUCache } from 'lru-cache';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile),
  QUALITY = 90,
  // A dozen or so 12-megapixel photos, enough to go back and forth between them.
  REMEMBERED_BYTES = 64 * 1024 * 1024,
  // Each conversion decodes a full-size photo, for the one the viewer opens.
  CONVERSION_CONCURRENCY = 2,
  MAX_QUEUED = 64,
  TIMEOUT_MS = 60_000,
  // What Windows' imaging component reports when no codec reads the file, and what Media
  // Foundation reports when the HEVC decoder the HEIF one relies on is missing.
  CODEC_MISSING_CODES = ['88982F50', 'C00D5212'],
  UNSUPPORTED = 'HEIC photos can be shown on macOS and Windows only.';

/** Why converting failed: on Windows, a missing codec is told apart from a broken photo. */
function conversionError(error: unknown, detail: string): Error {
  if (CODEC_MISSING_CODES.some((code) => detail.startsWith(code))) {
    return new Error(HEIF_CODECS_MISSING);
  }
  return new Error(`The system could not read this photo. ${detail}`.trim(), { cause: error });
}

/** A JPEG of `source` from `sips`, which writes a file, read and removed again. */
async function convertWithSips(source: string, signal: AbortSignal): Promise<Uint8Array> {
  const target = path.join(tmpdir(), `prism-${randomUUID()}.jpg`);
  try {
    await execFileAsync(
      'sips',
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(QUALITY), source, '--out', target],
      { signal, timeout: TIMEOUT_MS },
    );
    return new Uint8Array(await readFile(target));
  } catch (error) {
    signal.throwIfAborted();
    throw conversionError(error, String((error as { stderr?: unknown }).stderr ?? ''));
  } finally {
    await rm(target, { force: true });
  }
}

/** A JPEG of `source` from Windows' imaging component, which the addon calls in this process. */
async function convertWithWindows(source: string, signal: AbortSignal): Promise<Uint8Array> {
  try {
    return await convertToJpeg(source, QUALITY / 100, signal);
  } catch (error) {
    signal.throwIfAborted();
    throw conversionError(error, error instanceof Error ? error.message : String(error));
  }
}

/**
 * A full-size JPEG of the HEIF photo `source`, for the viewer. Quick Look and the Windows shell
 * only render small stills, so this takes the system's decoder itself: `sips` on macOS, and the
 * imaging component on Windows. Both turn the picture upright, `sips` by keeping the photo's
 * orientation for the window to apply.
 */
function convertHeif(source: string, signal: AbortSignal): Promise<Uint8Array> {
  if (process.platform === 'darwin') {
    return convertWithSips(source, signal);
  }
  if (process.platform === 'win32') {
    return convertWithWindows(source, signal);
  }
  return Promise.reject(new Error(UNSUPPORTED));
}

/**
 * Full-size JPEGs of the HEIF photos the viewer opens. They are kept in memory rather than on
 * disk, where they would crowd thumbnails out of the cache's budget: a session converts each
 * photo it opens once, until the ones opened longest ago make room for new ones.
 */
export interface HeifConversions {
  /** JPEGs converted, by the file, its size and its modification time. */
  readonly photos: LRUCache<string, Uint8Array>;
  /** Whether any conversion is queued or under way, as `queue.busy` says. */
  readonly queue: WorkQueue<Uint8Array>;
}

/** Conversions that stop as `signal` aborts. */
export function heifConversions(signal: AbortSignal): HeifConversions {
  return {
    photos: new LRUCache({
      maxSize: REMEMBERED_BYTES,
      sizeCalculation: (photo) => Math.max(1, photo.byteLength),
    }),
    queue: new WorkQueue(CONVERSION_CONCURRENCY, MAX_QUEUED, signal),
  };
}

/** The JPEG of `source`, converted again if it changed since it last was. */
export function heifJpeg(
  { photos, queue }: HeifConversions,
  { file, info }: ThumbnailSource,
): Promise<Uint8Array> {
  const key = JSON.stringify([file, info.size, info.mtimeMs]),
    known = photos.get(key);
  if (known) {
    return Promise.resolve(known);
  }
  return queue.run(key, async (signal) => {
    const photo = await convertHeif(file, signal);
    photos.set(key, photo);
    return photo;
  });
}

/**
 * Thumbnails of HEIF photos from the system's thumbnailer, `read`, or none without one. Quick
 * Look fills the box it is given, cropping what overflows, so the box takes the photo's shape,
 * which sharp can read though it cannot decode the picture. Where no codec reads the photo, the
 * system answers with the file's icon, which unlike a photo is not opaque.
 */
export function heifThumbnails(read?: FrameReader): FrameReader {
  return async (source, size, signal) => {
    if (!read) {
      throw new Error(UNSUPPORTED);
    }
    const { autoOrient } = await sharp(source).metadata();
    const scale = Math.min(1, size.width / autoOrient.width, size.height / autoOrient.height);
    const image = await read(
      source,
      {
        height: Math.max(1, Math.round(autoOrient.height * scale)),
        width: Math.max(1, Math.round(autoOrient.width * scale)),
      },
      signal,
    );
    if (!(await sharp(image).stats()).isOpaque) {
      throw new Error(
        process.platform === 'win32'
          ? HEIF_CODECS_MISSING
          : 'The system could not read this photo.',
      );
    }
    return image;
  };
}
