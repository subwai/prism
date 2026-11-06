import type { PhotoIndex } from '#photos/photo-index';
import type { PhotoEntry, PhotoExif } from '@prism/shared';
import exifr from 'exifr';
import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';

// Photos read at once. Each read is a few small reads of the file's start, so as with folders,
// a network share answers many at once about as fast as one.
const CONCURRENCY = 16;

// The tags a photo's details come from. Picking them lets exifr stop reading early, which
// matters on a network share: most cameras write them in the file's first few kilobytes.
const TAGS = [
  'DateTimeOriginal',
  'CreateDate',
  'Make',
  'Model',
  'LensModel',
  'ISO',
  'FNumber',
  'ExposureTime',
  'FocalLength',
];

interface Tags {
  DateTimeOriginal?: unknown;
  CreateDate?: unknown;
  Make?: unknown;
  Model?: unknown;
  LensModel?: unknown;
  ISO?: unknown;
  FNumber?: unknown;
  ExposureTime?: unknown;
  FocalLength?: unknown;
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positive(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function time(value: unknown) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.getTime() : undefined;
}

/** "Canon" and "Canon EOS R5" make "Canon EOS R5"; most models name their make already. */
function cameraName(make?: string, model?: string) {
  if (!make || !model) {
    return model ?? make;
  }
  return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
}

/** What `tags` say, leaving out what they do not. */
export function exifFrom(tags?: Tags): PhotoExif {
  if (!tags) {
    return {};
  }
  const exif: PhotoExif = {
    aperture: positive(tags.FNumber),
    camera: cameraName(text(tags.Make), text(tags.Model)),
    exposureSeconds: positive(tags.ExposureTime),
    focalLength: positive(tags.FocalLength),
    iso: positive(tags.ISO),
    lens: text(tags.LensModel),
    takenMs: time(tags.DateTimeOriginal) ?? time(tags.CreateDate),
  };
  return Object.fromEntries(
    Object.entries(exif).filter(([, value]) => value !== undefined),
  ) as PhotoExif;
}

/**
 * The EXIF details of the photo `file`. A file the parser cannot read, such as one in a format
 * without EXIF, has none; a failure to read the file at all rejects, so it is tried again later.
 */
export async function readExif(file: string): Promise<PhotoExif> {
  try {
    return exifFrom((await exifr.parse(file, { pick: TAGS })) as Tags | undefined);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      throw error;
    }
    return {};
  }
}

/**
 * The EXIF details of photos in the folder at `root`: from `index` if it read them while the
 * photo was as it is now, or else from the photo, then remembered there. Reads stop with `signal`.
 */
export class ExifDetails {
  private readonly reads = pLimit(CONCURRENCY);

  constructor(
    private readonly index: PhotoIndex,
    private readonly root: string,
    private readonly signal: AbortSignal,
  ) {}

  /** The details of the photo `file`, which is as `info` says. */
  async of(file: string, info: Stats, signal = this.signal): Promise<PhotoExif> {
    const indexed = { dev: info.dev, file, ino: info.ino, mtimeMs: info.mtimeMs, size: info.size };
    const known = this.index.exif(indexed);
    if (known) {
      return known;
    }
    return await this.reads(async () => {
      signal.throwIfAborted();
      const exif = await readExif(file);
      this.index.remember(indexed, exif);
      return exif;
    });
  }

  /** The details of the photo at `id`, or `undefined` if it cannot be read. */
  async at(id: string): Promise<PhotoExif | undefined> {
    const file = path.join(this.root, id);
    try {
      return await this.of(file, await stat(file));
    } catch {
      return undefined;
    }
  }

  /** `entry` with its details, if it is a photo they can be read from. */
  async add(entry: PhotoEntry): Promise<PhotoEntry> {
    if (entry.kind === 'image') {
      // Listed without them if they cannot be read, as a scan lists a photo it cannot read.
      entry.exif = await this.at(entry.id);
    }
    return entry;
  }

  close(): void {
    this.index.close();
  }
}
