import type { Sharp } from 'sharp';

/**
 * Whether `image` hides nothing: it has no alpha channel, or every pixel's alpha is full.
 * `stats().isOpaque` says the same, but works out every channel's statistics, entropy and
 * sharpness on the way, ten times slower on a large photo than reading the alpha channel alone.
 * Sharp scales a 16-bit alpha channel to 8 bits as it writes it raw.
 */
export async function isOpaque(image: Sharp): Promise<boolean> {
  if (!(await image.metadata()).hasAlpha) {
    return true;
  }
  const alpha = await image.clone().extractChannel('alpha').raw().toBuffer();
  // oxlint-disable-next-line typescript/prefer-for-of -- `for…of` and `every` are 8 times slower over a photo's alpha channel.
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] !== 255) {
      return false;
    }
  }
  return true;
}
