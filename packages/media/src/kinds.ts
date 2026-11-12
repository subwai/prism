import type { Dirent } from 'node:fs';
import path from 'node:path';

/** A file type the library shows: as what, served as which media type, and from whose stills. */
interface Format {
  kind: 'image' | 'video';
  type: string;
  /** A video Quick Look and the Windows shell render stills of; for the rest they return a
      generic file icon, which would pass for a thumbnail. */
  systemStill?: boolean;
}

const image = (type: string): Format => ({ kind: 'image', type });
const video = (type: string, systemStill = false): Format => ({ kind: 'video', systemStill, type });
// Videos are the formats Chromium plays, so the viewer can show every one the library lists.
// Ogg video is left out: it is almost always Theora, which Chromium no longer decodes.
const FORMATS = new Map<string, Format>([
  ['.avif', image('image/avif')],
  ['.gif', image('image/gif')],
  // HEIF and TIFF are shown converted, as Chromium decodes neither; see `needsConversion`.
  ['.heic', image('image/heic')],
  ['.heif', image('image/heif')],
  ['.jpeg', image('image/jpeg')],
  ['.jpg', image('image/jpeg')],
  ['.png', image('image/png')],
  ['.tif', image('image/tiff')],
  ['.tiff', image('image/tiff')],
  ['.webp', image('image/webp')],
  ['.m4v', video('video/mp4', true)],
  ['.mov', video('video/quicktime', true)],
  ['.mp4', video('video/mp4', true)],
  ['.webm', video('video/webm')],
]);
/** Prism's own Trash, at the top of a network share with none of its own. */
export const PRISM_TRASH = '.prism-trash';

// Folder metadata the system writes, often just from browsing in Finder or Explorer, and
// Prism's Trash, whose contents are gone as far as any view goes.
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', PRISM_TRASH]);

export function isIgnored(name: string): boolean {
  return IGNORED_NAMES.has(name);
}

/**
 * What a folder's `listing` shows, without symlinks or metadata files. A network share can list
 * a name more than once after its connection drops and comes back, as Finder then shows too, so
 * each name counts only the first time.
 */
export function listable(listing: Dirent[]): Dirent[] {
  const names = new Set<string>();
  return listing.filter((dirent) => {
    const repeated = names.has(dirent.name);
    names.add(dirent.name);
    return !repeated && !dirent.isSymbolicLink() && !isIgnored(dirent.name);
  });
}

function formatOf(file: string) {
  return FORMATS.get(path.extname(file).toLowerCase());
}

/** What a file shows as, by its extension; `null` for anything the viewer cannot show. */
export function mediaKind(file: string): 'image' | 'video' | null {
  return formatOf(file)?.kind ?? null;
}

/** Whether the system's thumbnailer can render a still of the video `file`. */
export function systemRendersVideo(file: string): boolean {
  return formatOf(file)?.systemStill === true;
}

/** The media type `file` is served as, by its extension, such as `image/jpeg`. */
export function mediaType(file: string): string {
  return formatOf(file)?.type ?? 'application/octet-stream';
}
