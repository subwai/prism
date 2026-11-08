import type { PhotoEntry, PhotoExif } from '@prism/shared';

export type { SortOrder } from '@prism/shared';
/** The ways to view a folder, in the order the View menu's switch steps through them. */
export const VIEW_MODES = ['grid', 'filmstrip', 'reader'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** Thumbnail sizes a view opens with, and that its slider goes back to on a double-click. */
export const THUMBNAIL_SIZE: Record<Exclude<ViewMode, 'reader'>, number> = {
  filmstrip: 76,
  grid: 170,
};

/** How wide the reader shows pages until its slider changes it, in CSS pixels. */
export const PAGE_WIDTH = 800;

/**
 * About how many `tile`-pixel tiles fit in a share of the window: a grid of `rows` fills it,
 * and a strip is one row.
 */
export function screenful(tile: number, { width = 1, height = 1, rows = true } = {}) {
  const columns = Math.ceil((globalThis.innerWidth * width) / tile);
  return rows ? columns * Math.ceil((globalThis.innerHeight * height) / tile) : columns;
}

/** Photos and videos: what the viewer shows and a slideshow steps through. */
export function isMedia(entry: PhotoEntry) {
  return entry.kind === 'image' || entry.kind === 'video';
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** `entries` by name, folders first, as a view sorted by name shows them. */
export function byName(entries: PhotoEntry[]): PhotoEntry[] {
  return entries.toSorted(
    (left, right) =>
      Number(right.kind === 'directory') - Number(left.kind === 'directory') ||
      collator.compare(left.name, right.name),
  );
}

export function formatSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

/** How a photo was taken, as a camera shows it: "Canon EOS R5 · 50 mm · ƒ/2.8 · 1/250 s · ISO 400". */
export function describeExif({ camera, focalLength, aperture, exposureSeconds, iso }: PhotoExif) {
  let exposure: string | undefined;
  if (exposureSeconds !== undefined) {
    exposure =
      exposureSeconds < 1 ? `1/${Math.round(1 / exposureSeconds)} s` : `${exposureSeconds} s`;
  }
  return [
    camera,
    focalLength === undefined ? undefined : `${Math.round(focalLength)} mm`,
    aperture === undefined ? undefined : `ƒ/${aperture}`,
    exposure,
    iso === undefined ? undefined : `ISO ${iso}`,
  ]
    .filter(Boolean)
    .join(' · ');
}
