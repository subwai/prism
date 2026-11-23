import { isOpaque, type StillImageReader } from '@prism/media';
import sharp from 'sharp';

/** The window takes this video's still image instead; see `storeVideoStillImage`. */
export class StillImageNeededError extends Error {
  override name = 'StillImageNeededError';
}

/** For videos the system cannot render a still image of: fails, so the window takes the still image instead. */
export const askWindowForStillImage: StillImageReader = () =>
  Promise.reject(
    new StillImageNeededError('The system cannot render a still image of this video.'),
  );

/**
 * Wraps `reader` so it fails on an icon. Quick Look answers with the file's icon when it cannot
 * render a still image, instead of failing. Still images are opaque and icons are not, so an icon
 * sends the video to the window instead.
 */
export function rejectIcons(reader: StillImageReader): StillImageReader {
  return async (source, size, signal) => {
    const image = await reader(source, size, signal);
    if (!(await isOpaque(sharp(image)))) {
      throw new StillImageNeededError('The system rendered an icon rather than a still image.');
    }
    return image;
  };
}
