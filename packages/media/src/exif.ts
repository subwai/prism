import type { PhotoExif } from '@prism/shared';
import exifr, { type Exifr } from 'exifr';

// The fields a photo's details come from, by the part of the file that holds them. Naming them
// lets exifr skip the rest, and stop reading early, which matters on a network share: most
// cameras and editors write them in the file's first few kilobytes. A photo's tags are its
// keywords, which Windows Explorer keeps in EXIF, Lightroom and Bridge in XMP, and older tools
// in IPTC; exifr has no way to pick fields from XMP, so it reads all of it.
// exifr declares its options type without exporting it.
const FIELDS: Parameters<typeof exifr.parse>[1] = {
  exif: {
    pick: [
      'DateTimeOriginal',
      'CreateDate',
      'LensModel',
      'ISO',
      'FNumber',
      'ExposureTime',
      'FocalLength',
    ],
  },
  gps: false,
  icc: false,
  ifd0: { pick: ['Make', 'Model', 'XPKeywords'] },
  ifd1: false,
  ihdr: false,
  interop: false,
  iptc: { pick: ['Keywords'] },
  jfif: false,
  xmp: true,
};

interface Fields {
  /** Windows' keywords, separated by semicolons. */
  XPKeywords?: unknown;
  /** XMP's `dc:subject`: one keyword, or a list. */
  subject?: unknown;
  /** IPTC's keywords: one, or a list. */
  Keywords?: unknown;
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

/** Windows writes its keywords as UTF-16 bytes; exifr passes them on as it finds them. */
function windowsText(value: unknown): string {
  if (Array.isArray(value) || value instanceof Uint8Array) {
    return Buffer.from(value as ArrayLike<number>)
      .toString('utf16le')
      .replaceAll('\0', '');
  }
  return typeof value === 'string' ? value : '';
}

/** The keywords every tool wrote, once each whatever their case, in the order they came. */
function keywords(fields: Fields) {
  const found = [
    ...windowsText(fields.XPKeywords).split(';'),
    ...[fields.subject, fields.Keywords].flat(),
  ];
  const tags = new Map<string, string>();
  for (const tag of found.map((value) => text(value)).filter((value) => value !== undefined)) {
    if (!tags.has(tag.toLocaleLowerCase())) {
      tags.set(tag.toLocaleLowerCase(), tag);
    }
  }
  return tags.size > 0 ? [...tags.values()] : undefined;
}

/** What `fields` say, leaving out what they do not. */
export function exifFrom(fields?: Fields): PhotoExif {
  if (!fields) {
    return {};
  }
  const exif: PhotoExif = {
    aperture: positive(fields.FNumber),
    camera: cameraName(text(fields.Make), text(fields.Model)),
    exposureSeconds: positive(fields.ExposureTime),
    focalLength: positive(fields.FocalLength),
    iso: positive(fields.ISO),
    lens: text(fields.LensModel),
    tags: keywords(fields),
    takenMs: time(fields.DateTimeOriginal) ?? time(fields.CreateDate),
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
  // `exifr.parse` leaves the file open when a file fails to parse, and the background reads
  // go through every photo of a library, so the reader is closed here whatever happens. Its
  // types leave out the file it reads, and declare the class as an instance.
  const reader = new (exifr.Exifr as unknown as typeof Exifr)(
    FIELDS as ConstructorParameters<typeof Exifr>[0],
  ) as Exifr & {
    file?: { close?: () => Promise<void> };
  };
  try {
    await reader.read(file);
    return exifFrom((await reader.parse()) as Fields | undefined);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      throw error;
    }
    return {};
  } finally {
    await reader.file?.close?.();
  }
}
