import { type FrameReader, isOpaque } from '@prism/media';
import sharp from 'sharp';

/** The window takes this video's still instead; see `WorkerBackend.storeThumbnail`. */
export class FrameNeededError extends Error {
  override name = 'FrameNeededError';
}

/** Stills of the videos the system cannot render, which the window takes instead. */
export const fromWindow: FrameReader = () =>
  Promise.reject(new FrameNeededError('The system cannot render a still of this video.'));

/**
 * Quick Look answers with the file's icon when it cannot render a still, rather than failing.
 * Stills are opaque and icons are not, so an icon sends the video to the window instead.
 */
export function stillsOnly(reader: FrameReader): FrameReader {
  return async (source, size, signal) => {
    const image = await reader(source, size, signal);
    if (!(await isOpaque(sharp(image)))) {
      throw new FrameNeededError('The system rendered an icon rather than a still.');
    }
    return image;
  };
}
