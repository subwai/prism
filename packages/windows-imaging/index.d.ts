/**
 * A JPEG of the image at `path`, of `quality` from 0 to 1, decoded by Windows' imaging component
 * and turned upright as its orientation asks. A failure's message starts with its HRESULT, in
 * eight hexadecimal digits, such as `88982F50` when no codec reads the file. Rejects on other
 * platforms, where the addon is not built.
 */
export function convertToJpeg(
  path: string,
  quality: number,
  signal?: AbortSignal,
): Promise<Uint8Array>;
