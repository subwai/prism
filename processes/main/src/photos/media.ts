import type { Dirent } from 'node:fs';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.avif',
    '.tif',
    '.tiff',
    // Shown through the system's codecs; see `isHeif`.
    '.heic',
    '.heif',
  ]),
  // Formats Chromium plays, so the viewer can show every video the library lists. Ogg video
  // is left out: it is almost always Theora, which Chromium no longer decodes.
  VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm']),
  // Of those, the ones Quick Look and the Windows shell render stills of. For the rest they
  // return a generic file icon, which would pass for a thumbnail.
  SYSTEM_VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov']),
  // Folder metadata the system writes, often just from browsing in Finder or Explorer.
  IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

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

/** What a file shows as, by its extension; `null` for anything the viewer cannot show. */
export function mediaKind(file: string): 'image' | 'video' | null {
  const extension = path.extname(file).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }
  return VIDEO_EXTENSIONS.has(extension) ? 'video' : null;
}

/** Whether the system's thumbnailer can render a still of the video `file`. */
export function systemRendersVideo(file: string): boolean {
  return SYSTEM_VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase());
}
