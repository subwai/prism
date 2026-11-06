import type { FolderSummary, PhotoEntry } from '@prism/shared';
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

// Enough to get past a few files that turn out to have no picture.
const MAX_COVERS = 4,
  // A folder without photos of its own looks this many folders inside it for a cover.
  MAX_COVER_FOLDERS = 256;

export function emptySummary(): FolderSummary {
  return { covers: [], hasEntries: false, hasSubfolders: false };
}

/** Whether `summary` has as good a set of covers as more entries could give it. */
export function hasBestCovers(summary: FolderSummary): boolean {
  return summary.covers.length === MAX_COVERS && summary.covers.at(-1)?.kind === 'image';
}

/** 1 for photos, so they sort ahead of videos. */
function isImage(entry: PhotoEntry) {
  return Number(entry.kind === 'image');
}

/** Photos make better covers than videos: they always have a picture to show. */
export function updateSummary(summary: FolderSummary, entry: PhotoEntry): void {
  summary.hasEntries = true;
  summary.hasSubfolders ||= entry.kind === 'directory';
  if ((entry.kind !== 'image' && entry.kind !== 'video') || hasBestCovers(summary)) {
    return;
  }
  summary.covers = [...summary.covers, entry]
    .toSorted((left, right) => isImage(right) - isImage(left))
    .slice(0, MAX_COVERS);
}

type WalkItem = { entry: PhotoEntry } | { error: { message: string } };

/**
 * A folder's own entries, and covers from the shallowest folder inside it that has photos or
 * videos, so a folder of folders still shows what it holds. `walk` lists the folder, and with
 * `recursive` everything inside it, breadth first.
 */
export async function summarize(
  directoryId: string,
  walk: (recursive: boolean) => AsyncIterable<WalkItem>,
): Promise<FolderSummary> {
  const summary = emptySummary();
  for await (const item of walk(false)) {
    if ('error' in item) {
      throw new Error(item.error.message);
    }
    updateSummary(summary, item.entry);
    if (summary.hasSubfolders && hasBestCovers(summary)) {
      break;
    }
  }
  if (summary.covers.length === 0 && summary.hasSubfolders) {
    summary.covers = await nestedCovers(directoryId, walk(true));
  }
  return summary;
}

/** The covers of the first folder inside `directoryId`, breadth first, that has any. */
async function nestedCovers(
  directoryId: string,
  walk: AsyncIterable<WalkItem>,
): Promise<PhotoEntry[]> {
  const summary = emptySummary();
  let looked = 0,
    found: string | undefined;
  for await (const item of walk) {
    // Folders that cannot be read are passed over, as their siblings may still have covers.
    if ('error' in item || item.entry.parentId === directoryId) {
      continue;
    }
    const { entry } = item;
    // The walk lists a folder's entries together, so one from elsewhere means it is done.
    if (found !== undefined && entry.parentId !== found) {
      break;
    }
    if (entry.kind === 'image' || entry.kind === 'video') {
      found = entry.parentId;
    } else if (entry.kind === 'directory') {
      looked += 1;
      if (looked > MAX_COVER_FOLDERS) {
        break;
      }
    }
    if (found !== undefined) {
      updateSummary(summary, entry);
      if (hasBestCovers(summary)) {
        break;
      }
    }
  }
  return summary.covers;
}
