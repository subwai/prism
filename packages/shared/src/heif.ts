/**
 * Whether the photo `name` is a HEIF file, the format iPhones use. Neither sharp, the worker's
 * image library, nor Chromium can decode its HEVC compression, so the system's codecs show it.
 */
export function isHeif(name: string): boolean {
  return /\.hei[cf]$/iu.test(name);
}

/**
 * Whether the window must be shown a converted copy of the photo `name` instead of the file
 * itself. That is true for HEIF, and for TIFF, which Chromium cannot decode either.
 */
export function needsConversion(name: string): boolean {
  return isHeif(name) || /\.tiff?$/iu.test(name);
}

/** Shown on Windows when a HEIF photo can't be decoded, as the codecs come from the Microsoft Store. */
export const HEIF_CODECS_MISSING_MESSAGE =
  'Install HEIF Image Extensions and HEVC Video Extensions from the Microsoft Store to show HEIC photos.';
