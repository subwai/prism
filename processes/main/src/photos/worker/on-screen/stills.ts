import { type FrameReader, isOpaque } from '@prism/media';
import sharp from 'sharp';

/** The window takes this video's still instead; see `storeVideoStill`. */
export class FrameNeededError extends Error {
  override name = 'FrameNeededError';
}

/** For videos the system cannot render a still of: fails, so the window takes the still instead. */
export const askWindowForStill: FrameReader = () =>
  Promise.reject(new FrameNeededError('The system cannot render a still of this video.'));

/**
 * Wraps `reader` so it fails on an icon. Quick Look answers with the file's icon when it cannot
 * render a still, instead of failing. Stills are opaque and icons are not, so an icon sends the
 * video to the window instead.
 */
export function rejectIcons(reader: FrameReader): FrameReader {
  return async (source, size, signal) => {
    const image = await reader(source, size, signal);
    if (!(await isOpaque(sharp(image)))) {
      throw new FrameNeededError('The system rendered an icon rather than a still.');
    }
    return image;
  };
}
