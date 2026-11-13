import { isOpaque } from '#opacity';
import sharp from 'sharp';
import { expect, test } from 'vitest';

/** A 4 by 2 RGBA image whose first pixel has alpha `first` and the rest are opaque. */
function image(first: number) {
  const pixels = Buffer.alloc(4 * 2 * 4, 200);
  for (let pixel = 0; pixel < 8; pixel += 1) {
    pixels[pixel * 4 + 3] = pixel === 0 ? first : 255;
  }
  return sharp(pixels, { raw: { channels: 4, height: 2, width: 4 } });
}

test('an image without an alpha channel is opaque', async () => {
  const plain = sharp({ create: { background: '#4678ab', channels: 3, height: 2, width: 4 } });
  await expect(isOpaque(plain)).resolves.toBe(true);
});

test('an alpha channel is opaque only if every pixel is', async () => {
  await expect(isOpaque(image(255))).resolves.toBe(true);
  await expect(isOpaque(image(254))).resolves.toBe(false);
});

/** `image(first)` with 16 bits a channel. */
async function deep(first: number) {
  return sharp(await image(first).toColourspace('rgb16').png().toBuffer());
}

test('a 16-bit alpha channel is read at its own depth', async () => {
  await expect(isOpaque(await deep(255))).resolves.toBe(true);
  await expect(isOpaque(await deep(254))).resolves.toBe(false);
});
